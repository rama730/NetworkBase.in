'use server';

import { getAuthUser } from '@/lib/supabase/auth-user';
import { previewWorkspaceSlug } from '@/lib/workspaces/server/slug-preview';

/** Info's address line (create wizard v6): the address Create will give this name right now. */
export async function previewWorkspaceSlugAction(title: string): Promise<{ base: string; slug: string; taken: boolean } | null> {
    const user = await getAuthUser();
    if (!user || !title.trim()) return null;
    try {
        return await previewWorkspaceSlug(title.slice(0, 100));
    } catch {
        return null;
    }
}
