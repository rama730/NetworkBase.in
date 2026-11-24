import { catalogEntry } from '@/lib/workflows/catalog';
import type { CreateWorkspaceInput } from '@/lib/validations/workspace';

/** One thing Create does, in the order it runs (create wizard v6: Review's "When you press Create" and the Creating screen). */
export type CreateStep = {
    key: 'make' | 'import' | 'upload' | 'doc' | `workflow:${string}` | 'people' | 'openings';
    label: string;
    count?: number;
    unit?: 'files';
    /** The GitHub import runs on the server: leaving the page doesn't stop it. */
    background?: boolean;
    /** A folder uploads from this browser: leaving the page stops it. */
    keepTabOpen?: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The steps Create will run for these values. The import or upload comes last, so everything else is ready first. */
export function createSteps(values: CreateWorkspaceInput, ctx: { uploadCount: number; peopleCount: number; orgTitle?: string | null }): CreateStep[] {
    const title = values.title?.trim();
    if (values.organization) {
        return [
            { key: 'make', label: `Making ${title || 'the organization'}` },
            ...(values.organization.co_admins?.length || values.organization.invite_emails?.trim() ? [{ key: 'people' as const, label: 'Sending invitations' }] : []),
        ];
    }
    const source = values.import_source;
    const metadata = (source?.metadata ?? {}) as { folderName?: string };
    const openings = (values.roles ?? []).filter((role) => role.role.trim()).reduce((n, role) => n + (role.count ?? 0), 0);
    const steps: CreateStep[] = [
        { key: 'make', label: `Making ${title || 'the workspace'}${ctx.orgTitle ? ` in ${ctx.orgTitle}` : ''}` },
        ...(values.readme?.mode === 'skip' ? [] : [{ key: 'doc' as const, label: `Drafting the starter doc${values.readme?.publishOnCreate ? ' and publishing it' : ''}` }]),
        ...(values.workflows ?? []).map((id) => ({ key: `workflow:${id}` as const, label: `Adding the ${catalogEntry(id)?.name ?? id} tab` })),
        ...(ctx.peopleCount ? [{ key: 'people' as const, label: `Adding ${plural(ctx.peopleCount, 'person', 'people')} to the teams` }] : []),
        ...(openings ? [{ key: 'openings' as const, label: `Posting ${plural(openings, 'opening')} on Discover` }] : []),
    ];
    if (source?.type === 'github') steps.push({ key: 'import', label: `Importing ${source.repoUrl?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') || 'the repository'}`, unit: 'files', background: true });
    if (source?.type === 'upload') steps.push({ key: 'upload', label: `Uploading ${metadata.folderName || 'your folder'}/`, count: ctx.uploadCount, unit: 'files', keepTabOpen: true });
    return steps;
}
