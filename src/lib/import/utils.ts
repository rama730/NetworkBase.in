import path from 'path';
import { db } from '@/lib/db';
import { workspaceNodes } from '@/lib/db/schema';
import { eq, and, inArray, isNull, sql } from 'drizzle-orm';

const ROOT_KEY = 'root';
const DB_BATCH_SIZE = 500;

function normalizeRelativePath(p: string): string {
    return (p || '').replaceAll('\\', '/').replace(/^\/+/, '');
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    if (size <= 0) return [arr];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}

function makeKey(parentId: string | null, name: string) {
    return `${parentId ?? ROOT_KEY}::${name}`;
}

async function fetchExistingNodes(
    projectId: string,
    type: 'folder' | 'file',
    entries: Array<{ parentId: string | null; name: string }>
) {
    const map = new Map<string, { id: string; parentId: string | null; name: string; path: string }>();
    if (entries.length === 0) return map;

    for (const batch of chunkArray(entries, DB_BATCH_SIZE)) {
        const parentIds = Array.from(new Set(batch.map(b => b.parentId)));
        const names = Array.from(new Set(batch.map(b => b.name))).filter(Boolean);
        if (names.length === 0) continue;

        const hasRoot = parentIds.includes(null);
        const nonNullParents = parentIds.filter(p => p !== null) as string[];

        const conditions: any[] = [
            eq(workspaceNodes.projectId, projectId),
            eq(workspaceNodes.type, type),
            isNull(workspaceNodes.deletedAt),
            inArray(workspaceNodes.name, names),
        ];

        if (hasRoot && nonNullParents.length > 0) {
            conditions.push(sql`(${inArray(workspaceNodes.parentId, nonNullParents)} OR ${isNull(workspaceNodes.parentId)})`);
        } else if (hasRoot) {
            conditions.push(isNull(workspaceNodes.parentId));
        } else if (nonNullParents.length > 0) {
            conditions.push(inArray(workspaceNodes.parentId, nonNullParents));
        } else {
            continue;
        }

        const rows = await db.query.workspaceNodes.findMany({
            where: and(...conditions),
            columns: { id: true, parentId: true, name: true, path: true },
        });

        for (const r of rows) {
            map.set(makeKey(r.parentId ?? null, r.name), {
                id: r.id,
                parentId: r.parentId ?? null,
                name: r.name,
                path: r.path,
            });
        }
    }

    return map;
}

export async function createDirectoryStructureFromPaths(
    projectId: string,
    dirPaths: Set<string>,
    userId: string
): Promise<Map<string, string>> {
    const sortedDirs = Array.from(dirPaths).sort(
        (a, b) => a.split('/').length - b.split('/').length
    );

    const folderIdByPath = new Map<string, string>();
    const dirsByDepth = new Map<number, string[]>();
    for (const dirPath of sortedDirs) {
        const depth = dirPath.split('/').length;
        const list = dirsByDepth.get(depth) || [];
        list.push(dirPath);
        dirsByDepth.set(depth, list);
    }

    const depths = Array.from(dirsByDepth.keys()).sort((a, b) => a - b);

    for (const depth of depths) {
        const paths = dirsByDepth.get(depth) || [];
        if (paths.length === 0) continue;

        const items = paths.map((dirPath) => {
            const parts = dirPath.split('/');
            const name = parts[parts.length - 1]!;
            const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
            const parentId = parentPath ? folderIdByPath.get(parentPath) ?? null : null;
            return { dirPath, parentId, name };
        });

        const existingMap = await fetchExistingNodes(
            projectId,
            'folder',
            items.map((i) => ({ parentId: i.parentId, name: i.name }))
        );

        const toInsert: Array<{
            projectId: string;
            parentId: string | null;
            type: 'folder';
            name: string;
            path: string;
            createdBy: string;
            createdAt: Date;
            updatedAt: Date;
        }> = [];
        const toPathUpdate: Array<{ id: string; path: string }> = [];
        const pathByKey = new Map<string, string>();

        for (const item of items) {
            const key = makeKey(item.parentId, item.name);
            const nodePath = `/${item.dirPath}`;
            const existing = existingMap.get(key);
            if (existing) {
                folderIdByPath.set(item.dirPath, existing.id);
                if (existing.path !== nodePath) {
                    toPathUpdate.push({ id: existing.id, path: nodePath });
                }
            } else {
                pathByKey.set(key, item.dirPath);
                const now = new Date();
                toInsert.push({
                    projectId,
                    parentId: item.parentId,
                    type: 'folder',
                    name: item.name,
                    path: nodePath,
                    createdBy: userId,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }

        if (toInsert.length > 0) {
            const inserted = await db.insert(workspaceNodes).values(toInsert).returning({
                id: workspaceNodes.id,
                parentId: workspaceNodes.parentId,
                name: workspaceNodes.name,
            });
            for (const row of inserted) {
                const key = makeKey(row.parentId ?? null, row.name);
                const path = pathByKey.get(key);
                if (path) folderIdByPath.set(path, row.id);
            }
        }

        if (toPathUpdate.length > 0) {
            const values = toPathUpdate.map((u) => sql`(${u.id}, ${u.path})`);
            await db.execute(sql`
                UPDATE ${workspaceNodes} AS t
                SET path = v.path,
                    updated_at = NOW()
                FROM (VALUES ${sql.join(values, sql`,`)}) AS v(id, path)
                WHERE t.id = v.id
            `);
        }
    }

    return folderIdByPath;
}

export async function insertVirtualFileNodes(
    projectId: string,
    files: { path: string; name: string; sha: string; size: number; mimeType: string }[],
    folderMap: Map<string, string>,
    userId: string
): Promise<void> {
    const toInsert = files.map((file) => {
        const dir = path.posix.dirname(normalizeRelativePath(file.path));
        const parentId = dir && dir !== '.' ? folderMap.get(dir) ?? null : null;
        
        return {
            projectId,
            parentId,
            type: 'file' as const,
            name: file.name,
            path: `/${normalizeRelativePath(file.path)}`,
            size: file.size,
            mimeType: file.mimeType,
            gitHash: file.sha,
            s3Key: null, // Virtual file, loaded on demand
            createdBy: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    });

    const chunks = chunkArray(toInsert, DB_BATCH_SIZE);
    await Promise.all(chunks.map(chunk => db.insert(workspaceNodes).values(chunk).onConflictDoNothing()));
}
