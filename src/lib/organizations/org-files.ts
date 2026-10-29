import "server-only";

import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";
import { starterFolders } from "@/lib/organizations/file-rules";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Starter folders by org type, created with the org (report §23.3); the staff folder is Admins only. */
export async function createStarterFolders(executor: Executor, orgId: string, userId: string, orgType: string | null) {
  await executor.insert(workspaceNodes).values(starterFolders(orgType).map((folder) => ({
    projectId: orgId,
    parentId: null,
    type: "folder" as const,
    name: folder.name,
    path: `/${folder.name}`,
    createdBy: userId,
    metadata: folder.access ? { access: folder.access } : {},
  })));
}
