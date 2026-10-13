import { z } from 'zod';
import { isValidGithubBranchName, normalizeGithubRepoUrl } from '@/lib/github/repo-validation';
import { validateProjectSocialLinks } from '@/lib/projects/social-links';

// Open Role Schema
export const openRoleSchema = z.object({
    role: z.string().trim().min(1, 'Role is required').max(100, 'Role title must be 100 characters or fewer'),
    count: z.number().min(1, 'Add at least one position').max(10, 'A role can have up to 10 positions').default(1),
    description: z.string().trim().max(2000, 'Role description must be 2000 characters or fewer').optional(),
    skills: z.array(z.string().max(80)).max(30).default([]),
    experienceLevel: z.enum(['any', 'junior', 'mid', 'senior']).default('any'),
    compensationType: z.enum(['unpaid', 'equity', 'paid', 'rev_share']).default('unpaid'),
    compensationDetails: z.string().max(500).optional(),
});

export type OpenRoleInput = z.infer<typeof openRoleSchema>;

// Creator Role Schema
export const creatorRoleSchema = z.object({
    // Keep legacy enum values for backward-compat drafts; wizard now always sets `lead`.
    role_type: z.enum(['founder', 'lead', 'contributor', 'advisor']).default('lead'),
    // Optional lead focus (e.g. Frontend, Product, AI).
    title: z.string().max(80).optional(),
    time_commitment: z.number().min(0).max(168).optional(), // hours per week
});

// External Links Schema
const legacyExternalLinksSchema = z.object({
    discord: z.string().url().optional().or(z.literal('')),
    github: z.string().url().optional().or(z.literal('')),
    website: z.string().url().optional().or(z.literal('')),
    figma: z.string().url().optional().or(z.literal('')),
    slack: z.string().url().optional().or(z.literal('')),
    notion: z.string().url().optional().or(z.literal('')),
});

const orderedExternalLinkSchema = z.object({
    id: z.string().min(1),
    url: z.string().min(1),
    platform: z.string().optional(),
    label: z.string().max(80).optional(),
    destinationLabel: z.string().max(160).optional(),
    purpose: z.enum(['live-product', 'source-code', 'documentation', 'design-prototype', 'research-publication', 'dataset-model', 'demo-media', 'community', 'distribution-store', 'roadmap-operations', 'support-contact', 'commerce-funding', 'other']).optional(),
    audience: z.enum(['public', 'members']).optional(),
    metadata: z.object({
        health: z.enum(['unknown', 'active', 'unavailable']),
        checkedAt: z.string().optional(),
        nameSource: z.enum(['provider', 'open_graph', 'html_title', 'url', 'manual']).optional(),
        fetchedAt: z.string().optional(),
        resolvedHost: z.string().optional(),
        contentType: z.string().optional(),
    }).optional(),
    order: z.number().int().nonnegative().optional(),
});

export const externalLinksSchema = z.union([
    legacyExternalLinksSchema,
    z.array(orderedExternalLinkSchema).max(20),
]).superRefine((value, ctx) => {
    const validation = validateProjectSocialLinks(value);
    if (!validation.success) ctx.addIssue({ code: z.ZodIssueCode.custom, message: validation.error });
});

// Create step 4 launch settings; each maps to a project setting that stays editable in Project settings.
export const projectPublicTabsSchema = z.object({
    dashboard: z.boolean(),
    readme: z.boolean(),
    updates: z.boolean(),
    files: z.boolean(),
    sprints: z.boolean(),
    tasks: z.boolean(),
});

// Three create-time switches over the project notification policy groups (see CREATE_PROJECT_NOTIFICATION_ROWS).
export const createProjectNotificationRowsSchema = z.object({
    roles_applications: z.boolean().default(true),
    work: z.boolean().default(true),
    updates_docs: z.boolean().default(true),
});

export const projectDocCreationIntentSchema = z.object({
    mode: z.enum(['detected', 'starter', 'skip']).default('starter'),
    sourcePath: z.string().max(500).nullable().optional(),
    publishOnCreate: z.boolean().default(false),
    includeRoles: z.boolean().default(true),
});

// Main Project Schema
// updateProject: owner edits from the modal and Settings. Archive and stage moves have their own
// guarded actions, so neither `archived` nor `currentStageIndex` is accepted here.
const boundedText = (max: number) => z.string().trim().max(max);
export const updateProjectSchema = z.object({
    title: boundedText(100).min(1, 'Title is required').optional(),
    shortDescription: boundedText(200).nullable().optional(),
    description: boundedText(5000).nullable().optional(),
    problemStatement: boundedText(5000).nullable().optional(),
    solutionStatement: boundedText(5000).nullable().optional(),
    category: boundedText(100).nullable().optional(),
    status: z.enum(['draft', 'active', 'completed']).optional(),
    tags: z.array(boundedText(50)).max(20).optional(),
    skills: z.array(boundedText(80)).max(30).optional(),
    externalLinks: externalLinksSchema.optional(),
    roles: z.array(z.object({
        id: z.string().max(64).optional(),
        role: boundedText(100).min(1, 'Role name is required'),
        count: z.number().int().min(1).max(10),
        description: boundedText(2000).nullable().optional(),
        skills: z.array(boundedText(80)).max(30).optional(),
    })).max(50).optional(),
    deletedRoleIds: z.array(z.string().max(64)).max(50).optional(),
    memberUpdatesEnabled: z.boolean().optional(),
    memberFileUploadDefault: z.boolean().optional(),
}).strict();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createProjectSchema = z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(100, 'Title must be less than 100 characters'),
    description: z.string().trim().min(20, 'Description must be at least 20 characters').max(5000, 'Description must be 5000 characters or fewer'),
    short_description: z.string().trim().max(200).optional(),
    project_type: z.string().min(1, 'Project type is required'),
    custom_project_type: z.string().optional(),
    status: z.enum(['draft', 'open', 'active', 'completed', 'archived']).default('open'),
    visibility: z.preprocess(
        (value) => value === 'unlisted' ? 'public' : value,
        z.enum(['public', 'private']).default('public'),
    ),
    tags: z.array(z.string()).default([]),
    technologies_used: z.array(z.string()).default([]),
    lifecycle_stages: z.array(z.string()).default([]),
    current_stage_index: z.number().default(0),
    problem_statement: z.string().optional(),
    solution_statement: z.string().optional(),
    target_audience: z.string().optional(),
    expected_start_date: z.string().optional(),
    expected_end_date: z.string().optional(),
    goals: z.array(z.string()).default([]),
    creator_role: creatorRoleSchema.nullable().optional(),
    roles: z.array(openRoleSchema).max(50, 'Cannot exceed 50 open roles').optional(),
    team_settings: z.any().nullable().optional(),
    external_links: externalLinksSchema.optional(),
    public_tab_visibility: projectPublicTabsSchema.optional(),
    member_updates_enabled: z.boolean().default(true),
    member_file_upload_default: z.boolean().default(true),
    doc_edit_policy: z.enum(['leaders', 'members']).default('leaders'),
    notification_rows: createProjectNotificationRowsSchema.optional(),
    readme: projectDocCreationIntentSchema.default({
        mode: 'starter',
        sourcePath: null,
        publishOnCreate: false,
        includeRoles: true,
    }),
    is_draft: z.boolean().default(false),
    metadata: z.record(z.string(), z.any()).default({}),
    import_source: z.object({
        type: z.enum(['github', 'upload', 'scratch']),
        repoUrl: z.string().optional(),
        branch: z.string().optional(),
        s3Key: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
    }).optional(),
    slug: z.string().optional(),
    project_id: z.string().optional(),
}).superRefine((val, ctx) => {
    const roleTitles = new Set<string>();
    for (let index = 0; index < (val.roles || []).length; index += 1) {
        const title = val.roles?.[index]?.role.trim().toLocaleLowerCase();
        if (!title) continue;
        if (roleTitles.has(title)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['roles', index, 'role'],
                message: 'Each open role needs a unique title.',
            });
        }
        roleTitles.add(title);
    }

    if (val.project_type === 'other') {
        const custom = (val.custom_project_type || '').trim();
        if (!custom) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['custom_project_type'],
                message: 'Custom project type is required when "Other" is selected.',
            });
        }
    }

    if (val.lifecycle_stages && val.lifecycle_stages.length > 0) {
        try {
            validateAndSanitizeLifecycleStages(val.lifecycle_stages);
        } catch (err) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['lifecycle_stages'],
                message: err instanceof Error ? err.message : 'Invalid lifecycle stages',
            });
        }
    }

    const src = val.import_source;
    if (!src) return;

    if (src.type === 'github') {
        const normalized = normalizeGithubRepoUrl(src.repoUrl || '');
        if (!normalized) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['import_source', 'repoUrl'],
                message: 'Enter a valid GitHub repository URL (https://github.com/owner/repo).',
            });
        }

        if (src.branch && !isValidGithubBranchName(src.branch)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['import_source', 'branch'],
                message: 'Branch name is invalid.',
            });
        }
    }
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export function validateAndSanitizeLifecycleStages(rawStages: string[]): string[] {
    if (!rawStages || rawStages.length === 0) {
        throw new Error("At least one lifecycle stage is required");
    }

    const stageNameRegex = /^[\p{L}\p{N}\s&]+$/u;
    const sanitizedStages: string[] = [];
    const seen = new Set<string>();

    for (const rawStage of rawStages) {
        const trimmed = (rawStage || "").trim().replace(/\s+/g, " ");
        if (!trimmed) continue;

        if (trimmed.length < 2 || trimmed.length > 35) {
            throw new Error(`Stage name "${trimmed}" must be between 2 and 35 characters`);
        }
        if (!stageNameRegex.test(trimmed)) {
            throw new Error(`Stage name "${trimmed}" contains invalid characters (only alphanumeric, spaces, and & are allowed)`);
        }

        const lower = trimmed.toLowerCase();
        if (seen.has(lower)) {
            throw new Error(`Duplicate stage name "${trimmed}" is not allowed`);
        }
        seen.add(lower);
        sanitizedStages.push(trimmed);
    }

    if (sanitizedStages.length === 0) {
        throw new Error("At least one valid lifecycle stage is required");
    }

    return sanitizedStages;
}
