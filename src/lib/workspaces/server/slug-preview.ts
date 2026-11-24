import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { generateSlugBase, isReservedWorkspaceSlug } from "@/lib/utils/slug";

/** The first free workspace address from `base`: `base` itself, then `base-2`, `base-3` … skipping reserved words and
 *  organization handles that are still held for their organization. Never a random ending (create wizard v6). */
export async function nextFreeWorkspaceSlug(base: string): Promise<string> {
    const root = base || "project";
    const pattern = `^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[0-9]+$`;
    const rows = await db.execute<{ slug: string }>(sql`
        SELECT slug FROM workspaces WHERE slug = ${root} OR slug ~ ${pattern}
        UNION SELECT handle AS slug FROM org_handle_holds WHERE handle = ${root} OR handle ~ ${pattern}`);
    const taken = new Set([...rows].map((row) => row.slug));
    for (let n = 1; ; n++) {
        const candidate = n === 1 ? root : `${root}-${n}`;
        if (!taken.has(candidate) && !isReservedWorkspaceSlug(candidate)) return candidate;
    }
}

/** What Info shows under the name: the plain address, and the one it will get when that is taken. */
export async function previewWorkspaceSlug(title: string): Promise<{ base: string; slug: string; taken: boolean }> {
    const base = generateSlugBase(title) || "project";
    const slug = await nextFreeWorkspaceSlug(base);
    return { base, slug, taken: slug !== base };
}
