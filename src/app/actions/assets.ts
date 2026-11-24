"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { taskNodeLinks, tasks, workspaceNodes } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { assetDetailsSchema, defaultAssetType, isAssetMime, mentions, readAssetDetails, usedIn, type AssetDetails } from "@/lib/workflows/assets";

/**
 * Report 38.16 O1 (plan A7.1): the Assets view of Files. Assets are files (call 1): reading follows the Files tab,
 * details follow file editing. Files inside a task stay with the task and aren't listed.
 */
const uuid = z.string().uuid();
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error && error.message.length < 200 ? error.message : fallback });

async function filesReader(projectId: string) {
  const { user } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  const access = await getWorkspaceAccessById(projectId, user.id);
  if (!access.project || access.project.kind !== "workspace" || !canReadWorkspaceTab(access, "files")) throw new Error("Not found");
  return { user, access };
}

export type AssetRow = { id: string; name: string; path: string; mimeType: string | null; size: number | null; version: number; updatedAt: string; details: AssetDetails | null; type: string; marked: boolean };

/** W1: images, video, audio and fonts, and any file marked as an asset; newest first (up to 500). */
export async function readAssetsAction(projectId: string) {
  try {
    if (!uuid.safeParse(projectId).success) throw new Error("Not found");
    const { access } = await filesReader(projectId);
    const rows = await db.select({ id: workspaceNodes.id, name: workspaceNodes.name, path: workspaceNodes.path, mimeType: workspaceNodes.mimeType, size: workspaceNodes.size,
      version: workspaceNodes.currentVersion, updatedAt: workspaceNodes.updatedAt, metadata: workspaceNodes.metadata }).from(workspaceNodes)
      .where(and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId),
        sql`(${workspaceNodes.mimeType} ~ '^(image|video|audio|font)/' OR ${workspaceNodes.name} ~* '\\.(woff2?|ttf|otf)$' OR ${workspaceNodes.metadata} ? 'asset')`))
      .orderBy(desc(workspaceNodes.updatedAt)).limit(500);
    // ponytail: 500 newest; paging when a workspace has more assets than that.
    const assets: AssetRow[] = rows.flatMap((r) => {
      const details = readAssetDetails(r.metadata);
      const marked = Boolean((r.metadata as { asset?: unknown } | null)?.asset);
      if (!marked && !isAssetMime(r.mimeType, r.name)) return [];
      return [{ id: r.id, name: r.name, path: r.path, mimeType: r.mimeType, size: r.size == null ? null : Number(r.size), version: r.version, updatedAt: r.updatedAt.toISOString(),
        details, type: details?.type ?? defaultAssetType(r.mimeType, r.name), marked }];
    });
    return { success: true as const, assets, canEdit: access.canWrite };
  } catch (error) {
    logger.warn("assets.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
    return fail(error, "Couldn’t load the assets.");
  }
}

const detailsInput = z.object({ projectId: uuid, nodeId: uuid, details: assetDetailsSchema.nullable() });

/** W2: save details (null takes a file that isn't media back out of Assets). Anyone who can change files. */
export async function setAssetDetailsAction(input: z.infer<typeof detailsInput>) {
  try {
    const data = detailsInput.parse(input);
    const { access } = await filesReader(data.projectId);
    if (!access.canWrite) throw new Error("Only people who can change files edit asset details.");
    const value = data.details ? JSON.stringify(Object.fromEntries(Object.entries(data.details).filter(([, v]) => v !== undefined && v !== ""))) : null;
    const [row] = await db.update(workspaceNodes)
      .set({ metadata: value == null ? sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) - 'asset'` : sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) || jsonb_build_object('asset', ${value}::jsonb)` })
      .where(and(eq(workspaceNodes.id, data.nodeId), eq(workspaceNodes.projectId, data.projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId)))
      .returning({ id: workspaceNodes.id });
    if (!row) throw new Error("File not found");
    return { success: true as const };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: "Tags are short words (letters, numbers, dashes)." };
    return fail(error, "Couldn’t save the details.");
  }
}

/** W2 Used in: tasks the file is attached to (content items included) and documents that show or name it. */
export async function readAssetUsedInAction(projectId: string, nodeId: string) {
  try {
    if (!uuid.safeParse(projectId).success || !uuid.safeParse(nodeId).success) throw new Error("Not found");
    await filesReader(projectId);
    const [file] = await db.select({ id: workspaceNodes.id, name: workspaceNodes.name, path: workspaceNodes.path }).from(workspaceNodes)
      .where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId), isNull(workspaceNodes.deletedAt))).limit(1);
    if (!file) throw new Error("File not found");
    const linked = await db.select({ id: tasks.id, title: tasks.title, number: tasks.taskNumber, type: tasks.itemType }).from(taskNodeLinks)
      .innerJoin(tasks, eq(tasks.id, taskNodeLinks.taskId))
      .where(and(eq(taskNodeLinks.nodeId, nodeId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(50);
    // Documents: their text as readers see it (the Documents tab's own read), searched for the file's path, name or id.
    // ponytail: reads up to 40 documents' text per open; an index of image links when workspaces have more.
    const { listWorkspaceDocsAction, readWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
    const list = await listWorkspaceDocsAction(projectId);
    const docs: Array<{ slug: string; title: string }> = [];
    if (list.success) {
      for (const d of list.docs.slice(0, 40)) {
        const doc = await readWorkspaceDocAction(projectId, d.slug).catch(() => null);
        if (doc?.success && doc.data.version?.content && mentions(doc.data.version.content, file)) docs.push({ slug: d.slug, title: d.title ?? d.filename.replace(/\.md$/i, "") });
      }
    }
    return { success: true as const, usedIn: usedIn(linked, docs) };
  } catch (error) {
    logger.warn("assets.used_in_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
    return fail(error, "Couldn’t work out where it’s used.");
  }
}

/** `nb assets tag <file> <tag>` (W10): adds a tag by path. */
export async function tagAssetByPathAction(projectId: string, path: string, tag: string) {
  const { access } = await filesReader(projectId);
  const full = path.startsWith("/") ? path : `/${path}`;
  const [node] = await db.select({ id: workspaceNodes.id, metadata: workspaceNodes.metadata }).from(workspaceNodes)
    .where(and(eq(workspaceNodes.projectId, projectId), inArray(workspaceNodes.path, [full, path]), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId))).limit(1);
  if (!node || !access.project) return { success: false as const, error: `No file ${full} here` };
  const details = readAssetDetails(node.metadata) ?? {};
  return setAssetDetailsAction({ projectId, nodeId: node.id, details: { ...details, tags: [...new Set([...(details.tags ?? []), tag.trim().toLowerCase()])] } });
}
