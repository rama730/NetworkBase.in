import "server-only";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The folders above `path` ("/a/b/c.txt" → /a, /a/b), made where missing; returns the parent folder's id (null = root). */
export async function ensureParentFoldersTx(tx: DbTransaction, projectId: string, path: string, userId: string): Promise<string | null> {
  const segments = path.split("/").filter(Boolean);
  let parentId: string | null = null;
  let folderPath = "";
  for (const name of segments.slice(0, -1)) {
    folderPath += `/${name}`;
    const existing = await tx.query.workspaceNodes.findFirst({
      where: and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.path, folderPath), eq(workspaceNodes.type, "folder"), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId)),
      columns: { id: true },
    });
    if (existing) { parentId = existing.id; continue; }
    const [made]: Array<{ id: string }> = await tx.insert(workspaceNodes)
      .values({ projectId, parentId, path: folderPath, type: "folder", name, createdBy: userId, currentVersion: 1, syncStatus: "merged" })
      .returning({ id: workspaceNodes.id });
    parentId = made!.id;
  }
  return parentId;
}
