import type { CreateWorkspaceInput } from '@/lib/validations/workspace';

export type PhaseProblems = Record<1 | 2 | 3 | 4 | 5, number>;

type Values = Pick<CreateWorkspaceInput, 'title' | 'description' | 'project_type' | 'custom_project_type' | 'roles' | 'import_source'> & { organization?: CreateWorkspaceInput['organization'] };

/**
 * How many things each step still needs before Create (the step strip's "3 to fix"). Mirrors the checks Continue runs
 * (useCreateWorkspaceWizard handleNext and createWorkspaceSchema); it never replaces them.
 */
export function phaseProblems(values: Partial<Values>, ctx: { uploadReady: boolean }): PhaseProblems {
    const source = values.import_source;
    const org = values.organization;
    let start = 0;
    if (org) start += (!org.org_type || (org.org_type === 'other' && !org.type_label?.trim()) ? 1 : 0) + (org.org_type === 'other' && org.kit === 'event_team' && !org.key_date ? 1 : 0);
    else if (source?.type === 'github') start += !(source.repoUrl ?? '').trim() || (source.metadata as Record<string, unknown> | undefined)?.githubPreflightStatus !== 'ok' ? 1 : 0;
    else if (source?.type === 'upload') start += ctx.uploadReady ? 0 : 1;

    let info = 0;
    if ((values.title ?? '').trim().length < 3) info += 1;
    if (!values.project_type) info += 1;
    else if (values.project_type === 'other' && !(values.custom_project_type ?? '').trim()) info += 1;
    if ((values.description ?? '').trim().length < 20) info += 1;
    if (org && !(org.handle ?? '').trim()) info += 1;

    let team = 0;
    const seen = new Set<string>();
    for (const role of values.roles ?? []) {
        const title = (role.role ?? '').trim().toLowerCase();
        if (!title) { team += 1; continue; }
        if (seen.has(title)) team += 1;
        seen.add(title);
    }
    return { 1: start, 2: info, 3: team, 4: 0, 5: 0 };
}
