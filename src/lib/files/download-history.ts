import "server-only";

import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/lib/db";
import { profiles, workspaceDownloadEvents } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export type DownloadKind = "file" | "version" | "folder_zip" | "selection_zip" | "submissions_zip";

export const DOWNLOAD_HISTORY_DAYS = 90;
const PAGE_SIZE = 50;

export async function insertDownloadEvent(input: {
  workspaceId: string;
  nodeId?: string | null;
  actorId: string | null;
  fileName: string;
  kind: DownloadKind;
  fileCount?: number;
}) {
  await db.insert(workspaceDownloadEvents).values({
    workspaceId: input.workspaceId,
    nodeId: input.nodeId ?? null,
    actorId: input.actorId,
    fileName: input.fileName.slice(0, 500),
    kind: input.kind,
    fileCount: input.fileCount ?? 1,
  });
}

/** Written after the response, so the record can never slow or fail a download. */
export function recordDownload(input: Parameters<typeof insertDownloadEvent>[0]) {
  after(() => insertDownloadEvent(input).catch((error) => {
    logger.warn("files.download_history_write_failed", {
      module: "files",
      error: error instanceof Error ? error.message : "unknown",
    });
  }));
}

/** Newest first. Rows whose person deleted their account, and signed-out downloads, have no name. */
export async function readDownloadHistory(input: {
  workspaceId: string;
  search?: string;
  actorId?: string;
  cursor?: { createdAt: string; id: string } | null;
}) {
  const search = input.search?.trim().replace(/[\\%_]/g, "\\$&");
  const rows = await db
    .select({
      id: workspaceDownloadEvents.id,
      fileName: workspaceDownloadEvents.fileName,
      kind: workspaceDownloadEvents.kind,
      fileCount: workspaceDownloadEvents.fileCount,
      createdAt: workspaceDownloadEvents.createdAt,
      // The page cursor keeps full precision: a JS Date would cut microseconds and repeat or skip rows at a boundary.
      cursorAt: sql<string>`${workspaceDownloadEvents.createdAt}::text`,
      actorId: workspaceDownloadEvents.actorId,
      actorName: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.username})`,
    })
    .from(workspaceDownloadEvents)
    .leftJoin(profiles, eq(profiles.id, workspaceDownloadEvents.actorId))
    .where(and(
      eq(workspaceDownloadEvents.workspaceId, input.workspaceId),
      input.actorId ? eq(workspaceDownloadEvents.actorId, input.actorId) : undefined,
      search ? ilike(workspaceDownloadEvents.fileName, `%${search}%`) : undefined,
      input.cursor
        ? or(
            lt(workspaceDownloadEvents.createdAt, sql`${input.cursor.createdAt}::timestamptz`),
            and(eq(workspaceDownloadEvents.createdAt, sql`${input.cursor.createdAt}::timestamptz`), lt(workspaceDownloadEvents.id, input.cursor.id)),
          )
        : undefined,
    ))
    .orderBy(desc(workspaceDownloadEvents.createdAt), desc(workspaceDownloadEvents.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > PAGE_SIZE && last ? { createdAt: last.cursorAt, id: last.id } : null,
  };
}

/** Everyone with a row in this workspace's history, for the person filter. */
export async function readDownloadHistoryPeople(workspaceId: string) {
  const rows = await db.execute<{ id: string; name: string | null }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username) AS name
    FROM public.profiles p
    WHERE EXISTS (SELECT 1 FROM public.workspace_download_events e WHERE e.workspace_id = ${workspaceId} AND e.actor_id = p.id)
    ORDER BY 2
    LIMIT 200`);
  return Array.from(rows);
}

export async function deleteExpiredDownloadEvents() {
  const deleted = await db.execute(sql`
    DELETE FROM public.workspace_download_events
    WHERE id IN (
      SELECT id FROM public.workspace_download_events
      WHERE created_at < now() - make_interval(days => ${DOWNLOAD_HISTORY_DAYS})
      LIMIT 5000
    )
    RETURNING id`);
  return Array.from(deleted).length;
}

/** A person's own downloads, for their account export. */
export function exportDownloadHistory(userId: string) {
  return db
    .select({
      file: workspaceDownloadEvents.fileName,
      kind: workspaceDownloadEvents.kind,
      fileCount: workspaceDownloadEvents.fileCount,
      downloadedAt: workspaceDownloadEvents.createdAt,
    })
    .from(workspaceDownloadEvents)
    .where(eq(workspaceDownloadEvents.actorId, userId))
    .orderBy(desc(workspaceDownloadEvents.createdAt))
    .limit(10_000);
}
