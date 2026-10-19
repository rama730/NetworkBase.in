import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/lib/db";
import { jobHeartbeats, projectNodeEvents, projectNodes } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";

const MAX_KEYS_PER_PROJECT = 200;
const MAX_EVENTS_PER_RUN = 200;
const RECONCILIATION_JOB_ID = "project-files-reconciliation";
const RECONCILIATION_RUNS_PER_DAY = 24; // cron "0 * * * *"
/** Acceptable delay before a missing or orphaned object is detected (PERF-006). */
export const RECONCILIATION_MAX_CYCLE_HOURS = 7 * 24;

/** Hours one full pass over every active file takes at the current page size and cadence. */
export function estimateReconciliationCycleHours(activeFiles: number, filesPerRun = MAX_KEYS_PER_PROJECT, runsPerDay = RECONCILIATION_RUNS_PER_DAY) {
    return Math.ceil(activeFiles / filesPerRun) * (24 / runsPerDay);
}

type ActiveFileRow = {
    nodeId: string;
    projectId: string;
    path: string;
    s3Key: string | null;
    size: number | null;
    mimeType: string | null;
};

type StorageObjectRow = {
    name: string;
    metadata: { size?: number | string; mimetype?: string } | null;
};

type ReconciliationCursor = {
    projectId: string;
    nodeId: string;
};

function readCursor(payload: unknown): ReconciliationCursor | null {
    if (!payload || typeof payload !== "object") return null;
    const value = payload as Partial<ReconciliationCursor>;
    return typeof value.projectId === "string" && typeof value.nodeId === "string"
        ? { projectId: value.projectId, nodeId: value.nodeId }
        : null;
}

export const reconcileProjectFiles = inngest.createFunction(
    { id: RECONCILIATION_JOB_ID, retries: 1, concurrency: 1 },
    { cron: "0 * * * *" },
    async () => {
        const [checkpoint] = await db
            .select({ payload: jobHeartbeats.lastPayload })
            .from(jobHeartbeats)
            .where(eq(jobHeartbeats.jobId, RECONCILIATION_JOB_ID))
            .limit(1);
        const cursor = readCursor(checkpoint?.payload);
        const basePredicate = and(
            eq(projectNodes.type, "file"),
            isNull(projectNodes.deletedAt),
        );
        const readPage = (after: ReconciliationCursor | null) => db
            .select({
                nodeId: projectNodes.id,
                projectId: projectNodes.projectId,
                path: projectNodes.path,
                s3Key: projectNodes.s3Key,
                size: projectNodes.size,
                mimeType: projectNodes.mimeType,
            })
            .from(projectNodes)
            .where(and(
                basePredicate,
                after
                    ? sql`(${projectNodes.projectId}, ${projectNodes.id}) > (${after.projectId}::uuid, ${after.nodeId}::uuid)`
                    : undefined,
            ))
            .orderBy(asc(projectNodes.projectId), asc(projectNodes.id))
            .limit(MAX_KEYS_PER_PROJECT);

        let rows = await readPage(cursor);
        if (rows.length === 0 && cursor) {
            rows = await readPage(null);
        }

        const activeFilesByKey = new Map<string, ActiveFileRow>();
        for (const row of rows) {
            const key = row.s3Key ? `${row.projectId}:${row.s3Key}` : `${row.projectId}:node:${row.nodeId}`;
            if (!activeFilesByKey.has(key)) {
                activeFilesByKey.set(key, {
                    nodeId: row.nodeId,
                    projectId: row.projectId,
                    path: row.path,
                    s3Key: row.s3Key,
                    size: row.size,
                    mimeType: row.mimeType,
                });
            }
        }
        const activeFiles = Array.from(activeFilesByKey.values());

        if (activeFiles.length === 0) {
            return {
                scannedProjects: 0,
                missingObjects: 0,
                orphanObjects: 0,
                emittedEvents: 0,
                skippedProjects: 0,
                failedInserts: 0,
            };
        }

        const byProject = new Map<string, ActiveFileRow[]>();
        for (const row of activeFiles) {
            const bucket = byProject.get(row.projectId) || [];
            bucket.push(row);
            byProject.set(row.projectId, bucket);
        }

        let missingObjects = 0;
        let orphanObjects = 0;
        const attachedObjects = 0;
        let mismatchedObjects = 0;
        let emittedEvents = 0;
        let queuedEvents = 0;
        let skippedProjects = 0;
        let failedInserts = 0;

        // The checkpoint may only move past projects that were fully examined (COR-020).
        let checkpointRow: (typeof rows)[number] | undefined;
        for (const [projectId, files] of byProject) {
            const canonicalPrefix = `${projectId}/%`;
            const legacyPrefix = `projects/${projectId}/%`;
            const linkedFiles = files.filter((file): file is ActiveFileRow & { s3Key: string } => Boolean(file.s3Key));
            const unlinkedCandidates = files
                .filter((file) => !file.s3Key)
                .map((file) => ({ file, key: buildProjectFileKey(projectId, file.path) }));

            let existingStorageRows: StorageObjectRow[] = [];
            let orphanStorageRows: StorageObjectRow[] = [];
            let candidateStorageRows: StorageObjectRow[] = [];
            try {
                const existingPromise = linkedFiles.length > 0
                    ? db.execute<StorageObjectRow>(sql`
                        SELECT name
                        FROM storage.objects
                        WHERE bucket_id = 'project-files'
                          AND name IN (${sql.join(linkedFiles.map((file) => sql`${file.s3Key}`), sql`, `)})
                    `)
                    : Promise.resolve([] as StorageObjectRow[]);
                const candidatePromise = unlinkedCandidates.length > 0
                    ? db.execute<StorageObjectRow>(sql`
                        SELECT name, metadata
                        FROM storage.objects
                        WHERE bucket_id = 'project-files'
                          AND name IN (${sql.join(unlinkedCandidates.map((candidate) => sql`${candidate.key}`), sql`, `)})
                    `)
                    : Promise.resolve([] as StorageObjectRow[]);
                const [existingResult, orphanResult, candidateResult] = await Promise.all([
                    existingPromise,
                    db.execute<StorageObjectRow>(sql`
                        SELECT objects.name, objects.metadata
                        FROM storage.objects AS objects
                        LEFT JOIN project_nodes AS nodes
                          ON nodes.project_id = ${projectId}::uuid
                         AND nodes.s3_key = objects.name
                         AND nodes.type = 'file'
                         AND nodes.deleted_at IS NULL
                        WHERE objects.bucket_id = 'project-files'
                          AND (objects.name LIKE ${canonicalPrefix} OR objects.name LIKE ${legacyPrefix})
                          AND nodes.id IS NULL
                          -- Retained revisions and registered assets still own their objects even when no
                          -- current node points at them (COR-020): only an object nothing references is an orphan.
                          AND NOT EXISTS (SELECT 1 FROM file_versions fv WHERE fv.s3_key = objects.name)
                          AND NOT EXISTS (
                            SELECT 1 FROM storage_assets sa
                            WHERE sa.bucket = 'project-files' AND sa.storage_key = objects.name
                              AND sa.state IN ('pending', 'verified', 'delete_pending', 'deleting')
                          )
                        ORDER BY objects.name ASC
                        LIMIT ${MAX_KEYS_PER_PROJECT}
                    `),
                    candidatePromise,
                ]);
                existingStorageRows = Array.from(existingResult);
                orphanStorageRows = Array.from(orphanResult);
                candidateStorageRows = Array.from(candidateResult);
            } catch (error) {
                console.warn("[project-files-reconciliation] failed to query storage.objects", {
                    projectId,
                    error: error instanceof Error ? error.message : String(error),
                });
                skippedProjects += 1;
                // A project that cannot be read right now is skipped, not retried forever; the counter reports it.
                checkpointRow = rows.findLast((row) => row.projectId === projectId) ?? checkpointRow;
                continue;
            }
            const storageKeySet = new Set(existingStorageRows.map((row) => row.name));
            const candidateByName = new Map(candidateStorageRows.map((row) => [row.name, row]));
            const candidateKeyCounts = new Map<string, number>();
            for (const candidate of unlinkedCandidates) {
                candidateKeyCounts.set(candidate.key, (candidateKeyCounts.get(candidate.key) ?? 0) + 1);
            }

            const missingForProject = linkedFiles.filter((file) => !storageKeySet.has(file.s3Key));
            // A path-correlated object is a repair candidate, not an orphan. Keep
            // categories mutually exclusive even before a safe repair is committed.
            const orphanForProject = orphanStorageRows.filter((row) => !candidateByName.has(row.name));

            missingObjects += missingForProject.length;
            orphanObjects += orphanForProject.length;

            const events = [];

            for (const candidate of unlinkedCandidates) {
                const object = candidateByName.get(candidate.key);
                if (!object) continue;
                if ((candidateKeyCounts.get(candidate.key) ?? 0) !== 1) {
                    mismatchedObjects += 1;
                    const reconciliationKey = `ambiguous-path:${candidate.file.nodeId}:${candidate.key}`;
                    events.push({
                        projectId,
                        nodeId: candidate.file.nodeId,
                        actorId: null,
                        type: "storage_reconcile_ambiguous_path",
                        metadata: { s3Key: candidate.key, reconciliationKey },
                        createdAt: new Date(),
                    });
                    continue;
                }
                const objectSize = Number(object.metadata?.size);
                const expectedSize = candidate.file.size;
                const objectMime = object.metadata?.mimetype?.toLowerCase() ?? null;
                const expectedMime = candidate.file.mimeType?.toLowerCase() ?? null;
                const metadataMatches = (
                    (expectedSize === null || !Number.isFinite(objectSize) || objectSize === expectedSize)
                    && (!expectedMime || !objectMime || objectMime === expectedMime)
                );
                const reconciliationKey = metadataMatches
                    ? `unclaimed-candidate:${candidate.file.nodeId}:${candidate.key}`
                    : `path-mismatch:${candidate.file.nodeId}:${candidate.key}`;

                if (!metadataMatches) {
                    mismatchedObjects += 1;
                    events.push({
                        projectId,
                        nodeId: candidate.file.nodeId,
                        actorId: null,
                        type: "storage_reconcile_path_mismatch",
                        metadata: { s3Key: candidate.key, reconciliationKey },
                        createdAt: new Date(),
                    });
                    continue;
                }

                // A matching path and provider metadata are discovery evidence,
                // not proof that this object belongs to the node. Keep the
                // candidate quarantined until a verified manifest or operator
                // repair binds its full digest and asset identity.
                mismatchedObjects += 1;
                events.push({
                    projectId,
                    nodeId: candidate.file.nodeId,
                    actorId: null,
                    type: "storage_reconcile_unclaimed_candidate",
                    metadata: {
                        s3Key: candidate.key,
                        reconciliationKey,
                        metadataMatched: true,
                        quarantineRequired: true,
                    },
                    createdAt: new Date(),
                });
            }

            for (const file of missingForProject) {
                if (queuedEvents >= MAX_EVENTS_PER_RUN) break;
                const reconciliationKey = `missing:${file.nodeId}:${file.s3Key}`;
                events.push({
                    projectId,
                    nodeId: file.nodeId,
                    actorId: null,
                    type: "storage_reconcile_missing_object",
                    metadata: { s3Key: file.s3Key, reconciliationKey },
                    createdAt: new Date(),
                });
                queuedEvents++;
            }

            for (const orphan of orphanForProject) {
                if (queuedEvents >= MAX_EVENTS_PER_RUN) break;
                const reconciliationKey = `orphan:${projectId}:${orphan.name}`;
                events.push({
                    projectId,
                    nodeId: null,
                    actorId: null,
                    type: "storage_reconcile_orphan_object",
                    metadata: { s3Key: orphan.name, reconciliationKey },
                    createdAt: new Date(),
                });
                queuedEvents++;
            }

            if (events.length > 0) {
                try {
                    const keys = events.map((event) => String(event.metadata.reconciliationKey));
                    const existingKeys = Array.from(await db.execute<{ key: string }>(sql`
                        SELECT metadata->>'reconciliationKey' AS key
                        FROM project_node_events
                        WHERE project_id = ${projectId}::uuid
                          AND metadata->>'reconciliationKey' = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)))
                    `));
                    const seenKeys = new Set(existingKeys.map((row) => row.key));
                    const newEvents = events.filter((event) => !seenKeys.has(String(event.metadata.reconciliationKey)));
                    const remainingEventBudget = Math.max(0, MAX_EVENTS_PER_RUN - emittedEvents);
                    const boundedEvents = newEvents.slice(0, remainingEventBudget);
                    if (boundedEvents.length > 0) {
                        await db.insert(projectNodeEvents).values(boundedEvents);
                        emittedEvents += boundedEvents.length;
                    }
                } catch (error) {
                    console.error("[project-files-reconciliation] failed to insert events", {
                        projectId,
                        eventCount: events.length,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    failedInserts += events.length;
                }
            }

            // Reaching the event cap inside this project means it was only partly reported: stay before it.
            if (queuedEvents >= MAX_EVENTS_PER_RUN) break;
            checkpointRow = rows.findLast((row) => row.projectId === projectId) ?? checkpointRow;
        }

        const lastRow = checkpointRow;
        if (lastRow) {
            const now = new Date();
            await db.insert(jobHeartbeats)
                .values({
                    jobId: RECONCILIATION_JOB_ID,
                    lastSuccessAt: now,
                    lastPayload: { projectId: lastRow.projectId, nodeId: lastRow.nodeId },
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: jobHeartbeats.jobId,
                    set: {
                        lastSuccessAt: now,
                        lastPayload: { projectId: lastRow.projectId, nodeId: lastRow.nodeId },
                        updatedAt: now,
                    },
                });
        }

        // Measure the detection delay this cadence implies, so growth shows up before it matters.
        const [{ total } = { total: 0 }] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(projectNodes)
            .where(basePredicate);
        const estimatedCycleHours = estimateReconciliationCycleHours(total);
        if (estimatedCycleHours > RECONCILIATION_MAX_CYCLE_HOURS) {
            logger.warn("project.files.reconciliation.cycle_too_long", { module: "storage", count: total, value: estimatedCycleHours });
        }

        return {
            scannedProjects: byProject.size,
            estimatedCycleHours,
            missingObjects,
            orphanObjects,
            attachedObjects,
            mismatchedObjects,
            emittedEvents,
            skippedProjects,
            failedInserts,
        };
    },
);
