import { orgTypeLabel } from '@/lib/organizations/config';
import type { CreateWorkspaceInput } from '@/lib/validations/workspace';
import type { Workspace } from '@/types/discover';

type PreviewUser = { id: string; email?: string | null; user_metadata?: Record<string, any> } | null | undefined;

/** The form as the real Discover card's view model (create wizard v6): Review's "Where it shows" and Finish's card. */
export function buildPreviewWorkspace(values: CreateWorkspaceInput, ctx: { noun: string; coverUrl: string | null; user: PreviewUser; cardOrg?: { id: string; title: string; slug: string | null }; id?: string; slug?: string }): Workspace {
    return {
        id: ctx.id ?? 'preview-project',
        key: 'PRV',
        title: values.title || `Untitled ${ctx.noun}`,
        description: values.description || '',
        shortDescription: values.short_description || '',
        slug: ctx.slug ?? 'preview',
        status: 'draft',
        syncStatus: 'ready',
        visibility: values.visibility === 'private' ? 'private' : 'public',
        category: values.project_type === 'other' ? values.custom_project_type || 'Other' : values.project_type || 'General',
        coverImageUrl: ctx.coverUrl || undefined,
        avatarUrl: ctx.coverUrl || undefined,
        skills: [...(values.tags || []), ...(values.technologies_used || [])],
        externalLinks: values.external_links || {},
        githubRepoUrl: values.import_source?.repoUrl || undefined,
        owner: ctx.user ? {
            id: ctx.user.id,
            fullName: ctx.user.user_metadata?.full_name || ctx.user.email || 'You',
            displayName: ctx.user.user_metadata?.full_name || 'You',
            username: ctx.user.user_metadata?.user_name || 'you',
            avatarUrl: ctx.user.user_metadata?.avatar_url || null,
        } : {
            id: 'you',
            fullName: 'You',
            displayName: 'You',
            username: 'you',
            avatarUrl: null,
        },
        openRoles: (values.roles || []).map((r, i) => ({
            id: `role-${i}`,
            projectId: ctx.id ?? 'preview-project',
            role: r.role,
            count: r.count,
            filled: 0,
            skills: r.skills || [],
            description: r.description,
        })),
        collaboratorsCount: 1,
        followersCount: 0,
        // An organization previews as its Discover card (report §34.7).
        ...(values.organization ? {
            kind: 'organization', orgType: values.organization.org_type ?? null, orgPartOf: values.organization.part_of || null,
            orgTypeLabel: orgTypeLabel(values.organization.org_type, { typeLabel: values.organization.type_label }),
            category: values.custom_project_type || null, skills: values.tags || [], childProjectCount: 0,
        } : {}),
        cardOrg: ctx.cardOrg,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    } as unknown as Workspace;
}
