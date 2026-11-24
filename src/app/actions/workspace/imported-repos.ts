'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/supabase/auth-user';

export type ImportedRepo = { url: string; title: string; slug: string | null };

/**
 * Repositories the signed-in person already has as a workspace (owner or member, not deleted), so Start can say
 * "Already a workspace · Open {title}" instead of offering a second import (create wizard v6).
 */
export async function listImportedRepoUrlsAction(): Promise<{ success: true; repos: ImportedRepo[] } | { success: false; error: string }> {
    const user = await getAuthUser();
    if (!user) return { success: false, error: 'Sign in to continue' };
    try {
        const rows = await db.execute<{ url: string; title: string; slug: string | null }>(sql`
            SELECT DISTINCT ON (lower(rtrim(p.github_repo_url, '/'))) rtrim(p.github_repo_url, '/') AS url, p.title, p.slug
            FROM workspaces p
            LEFT JOIN workspace_members pm ON pm.workspace_id = p.id AND pm.user_id = ${user.id}::uuid
            WHERE p.deleted_at IS NULL AND p.deletion_scheduled_at IS NULL AND p.kind <> 'organization'
              AND nullif(btrim(p.github_repo_url), '') IS NOT NULL
              AND (p.owner_id = ${user.id}::uuid OR pm.user_id IS NOT NULL)
            ORDER BY lower(rtrim(p.github_repo_url, '/')), p.created_at DESC
            LIMIT 500`);
        return { success: true, repos: [...rows].map((r) => ({ url: r.url, title: r.title, slug: r.slug })) };
    } catch {
        return { success: false, error: 'Couldn’t check your workspaces' };
    }
}
