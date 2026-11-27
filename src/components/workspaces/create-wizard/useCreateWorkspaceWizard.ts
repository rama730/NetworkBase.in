'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createWorkspaceSchema, type CreateWorkspaceInput, type OpenRoleInput } from '@/lib/validations/workspace';
import { DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY } from '@/lib/workspaces/settings-policies';
import { toast, feedbackError } from "@/lib/feedback";
import { TOTAL_PHASES, WizardPhaseId } from '@/constants/workspace-wizard';
import { createWorkspaceAction } from '@/app/actions/workspace';
import { checkOrgHandleAction } from '@/app/actions/organizations';
import { parseGithubRepo } from '@/lib/github/repo-preview';
import { fetchGithubImportPreviewFolder, fetchGithubImportPreviewRoot } from '@/lib/github/import-client';
import { shouldIgnorePath } from '@/lib/import/import-filters';
import { getLifecycleStagesForWorkspaceType } from '@/lib/workspaces/lifecycle-templates';
import { buildWorkspaceDocStarterDraft } from '@/lib/workspaces/doc-create-intent';
import { buildWorkspaceImportEventId, buildUploadManifestHash } from '@/lib/import/idempotency';
import { buildWorkspaceFileKey } from '@/lib/storage/workspace-file-key';
import { useAuth } from '@/hooks/use-auth';
import { createSteps, type CreateStep } from './create-steps';
import type { CreatedOrganization } from '@/components/organizations/OrganizationCreatedScreen';

/** The Creating view's state (v6): which step runs, its file count, and where it stopped. */
export type CreateProgress = { steps: CreateStep[]; index: number; title: string; count?: number; total?: number; failedAt?: number; error?: string; projectId?: string };
/** Create finished, fully or with a step left over (the Finish view's first Get started task). */
export type CreateFinished = {
    projectId: string;
    slug: string | null;
    organization?: CreatedOrganization;
    partial?: { key: string; label: string; at?: number; total?: number };
    importing?: { at: number; total: number };
};
const IMPORT_POLL_MS = 2000;

export interface WizardContextType {
    openRoles: OpenRoleInput[];
    openRoleIds: string[];
    /** Adds a role (optionally with a title from the composer or a popular role). */
    addRole: (init?: Partial<OpenRoleInput>) => void;
    updateRole: (index: number, updates: Partial<OpenRoleInput>) => void;
    removeRole: (index: number) => void;
    /** Inserts "{title} (copy)" right below, without its people (a person sits in one team at a time). */
    duplicateRole: (index: number) => void;
    /** Reorders roles (drag on the number box, or ArrowUp/ArrowDown on it). */
    moveRole: (from: number, to: number) => void;
    /** Fills an empty team from the org's default units, once per org (report §14.4 additions). */
    prefillUnits: (orgId: string, names: string[]) => void;
}

interface UseCreateProjectWizardProps {
    onClose: () => void;
    onSuccess?: (projectId: string, organization?: import('@/components/organizations/OrganizationCreatedScreen').CreatedOrganization) => void;
    initialValues?: CreateWorkspaceInput;
    initialPhase?: WizardPhaseId;
}

/**
 * useCreateWorkspaceWizard - The master hook for project creation.
 * Pure Optimization: Unified constants, reactive draft management, and scalable logic.
 */
type SourceFillField = 'title' | 'short_description' | 'description' | 'technologies_used';
/** What Start filled into empty Info fields from a README, what each field held before, and where it came from. */
export type SourceFill = { kind: 'repo' | 'folder'; label: string; fields: SourceFillField[]; values: Partial<Record<SourceFillField, unknown>>; previous: Partial<Record<SourceFillField, unknown>> };

export function useCreateWorkspaceWizard({ onClose, onSuccess, initialValues, initialPhase = 1 }: UseCreateProjectWizardProps) {
    const { user } = useAuth();
    const userId = user?.id || null;
    const [phase, setPhase] = useState<WizardPhaseId>(initialPhase);
    // Create wizard v6: true after leaving Review for an earlier step (never saved in the draft: it isn't a form value).
    const [fromReview, setFromReview] = useState(false);
    const phaseRef = useRef<WizardPhaseId>(phase);
    useEffect(() => {
        phaseRef.current = phase;
    }, [phase]);
    const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
    // Step 4 project picture: held in memory, uploaded right after the project exists.
    const [projectImage, setProjectImage] = useState<File | null>(null);
    const [uploadProgress, setUploadProgress] = useState<{
        percent: number;
        currentFile: string;
        isUploading: boolean;
    } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [phase2ValidationAttempted, setPhase2ValidationAttempted] = useState(false);
    const [phase3ValidationAttempted, setPhase3ValidationAttempted] = useState(false);
    const [phase4ValidationAttempted, setPhase4ValidationAttempted] = useState(false);
    const [phase4LinkComposerPending, setPhase4LinkComposerPending] = useState(false);
    const [isPhaseTransitioning, setIsPhaseTransitioning] = useState(false);
    const [isReviewReady, setIsReviewReady] = useState(false);
    const phaseTransitionRef = useRef(false);
    const submissionRef = useRef(false);
    const phaseTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [draftInfo, setDraftInfo] = useState<{
        exists: boolean;
        phase: number;
        savedAt: Date | null;
        parentOrgId?: string | null;
    } | null>(null);

    // Form Setup
    const methods = useForm<CreateWorkspaceInput>({
        resolver: zodResolver(createWorkspaceSchema) as any,
        mode: 'onChange',
        defaultValues: initialValues ?? {
            title: '',
            description: '',
            short_description: '',
            project_type: '',
            custom_project_type: '',
            status: 'open',
            visibility: 'public',
            tags: [],
            technologies_used: [],
            lifecycle_stages: [],
            current_stage_index: 0,
            creator_role: {
                title: '',
            },
            roles: [],
            import_source: { type: 'scratch' },
            external_links: [],
            // Step 4 launch settings; defaults match Project settings so Continue works untouched.
            public_tab_visibility: { ...DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY },
            member_updates_enabled: true,
            member_file_upload_default: true,
            doc_edit_policy: 'leaders',
            notification_rows: { roles_applications: true, work: true, updates_docs: true },
            readme: {
                mode: 'starter',
                sourcePath: null,
                publishOnCreate: false,
                includeRoles: true,
            },
            metadata: {},
        },
    });

    const { getValues, setValue, trigger, formState: { isDirty }, watch, reset } = methods;
    // What Start filled from a repository's or folder's README (v6), so Info can mark it and Undo it. Not a form value.
    const [sourceFill, setSourceFill] = useState<SourceFill | null>(null);
    const undoSourceFill = useCallback(() => {
        if (!sourceFill) return;
        for (const field of sourceFill.fields) setValue(field, (sourceFill.previous[field] ?? (field === 'technologies_used' ? [] : '')) as never, { shouldDirty: true });
        setSourceFill(null);
    }, [setValue, sourceFill]);
    const {
        fields: openRoleFields,
        append: appendOpenRole,
        remove: removeOpenRole,
        insert: insertOpenRole,
        move: moveOpenRole,
    } = useFieldArray({
        control: methods.control,
        name: 'roles',
    });
    const openRoles = watch('roles') || [];

    // --- Lifecycle Autofill (Phase 3) ---
    const watchedProjectType = watch('project_type');
    const watchedLifecycleStages = watch('lifecycle_stages') || [];
    const lastAutofilledStagesRef = useRef<string[] | null>(null);

    const arraysEqual = useCallback((a: string[] | null | undefined, b: string[] | null | undefined) => {
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }, []);

    useEffect(() => {
        const type = (watchedProjectType || '').trim();
        if (!type) return;

        // If empty, always autofill from template.
        if (!watchedLifecycleStages || watchedLifecycleStages.length === 0) {
            const next = getLifecycleStagesForWorkspaceType(type);
            setValue('lifecycle_stages', next, { shouldDirty: true });
            lastAutofilledStagesRef.current = next;
            return;
        }

        // If the user hasn't edited (still equals last autofill), update when type changes.
        if (lastAutofilledStagesRef.current && arraysEqual(watchedLifecycleStages, lastAutofilledStagesRef.current)) {
            const next = getLifecycleStagesForWorkspaceType(type);
            if (!arraysEqual(next, watchedLifecycleStages)) {
                setValue('lifecycle_stages', next, { shouldDirty: true });
                lastAutofilledStagesRef.current = next;
            }
            return;
        }

        // If stages equal the server generic default (legacy), consider it “un-edited” and upgrade to template once.
        const legacyDefault = ["Concept", "Team formation", "MVP", "Beta", "Launch"];
        if (arraysEqual(watchedLifecycleStages, legacyDefault)) {
            const next = getLifecycleStagesForWorkspaceType(type);
            setValue('lifecycle_stages', next, { shouldDirty: true });
            lastAutofilledStagesRef.current = next;
        }
    }, [arraysEqual, setValue, watchedLifecycleStages, watchedProjectType]);

    // --- GitHub Preview (Phase 1) ---
    type GithubPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
    type GithubExcludedReason = 'ignored' | 'tooLarge';
    type GithubPreviewEntry = {
        name: string;
        path: string;
        type: 'file' | 'dir';
        size?: number | null;
        excludedReason?: GithubExcludedReason;
    };

    const [githubPreview, setGithubPreview] = useState<{
        status: GithubPreviewStatus;
        repoUrl: string;
        branch: string | null;
        rootEntries: GithubPreviewEntry[];
        errorMessage: string | null;
    }>({
        status: 'idle',
        repoUrl: '',
        branch: null,
        rootEntries: [],
        errorMessage: null,
    });

    const [githubFolderEntries, setGithubFolderEntries] = useState<Record<string, GithubPreviewEntry[]>>({});
    const latestGithubPreviewRequestRef = useRef('');

    // useWatch, not watch(): whole-object import_source writes must still reset the GitHub preview.
    const [importSourceType, watchedRepoUrl, watchedBranch] = useWatch({
        control: methods.control,
        name: ['import_source.type', 'import_source.repoUrl', 'import_source.branch'],
    });

    const resetGithubPreview = useCallback(() => {
        latestGithubPreviewRequestRef.current = '';
        setGithubPreview({
            status: 'idle',
            repoUrl: '',
            branch: null,
            rootEntries: [],
            errorMessage: null,
        });
        setGithubFolderEntries({});
    }, []);

    // Reset preview when source or repo changes.
    useEffect(() => {
        if (importSourceType !== 'github') {
            if (githubPreview.status !== 'idle') resetGithubPreview();
            return;
        }

        const nextUrl = (watchedRepoUrl || '').trim();
        if (!nextUrl) {
            if (githubPreview.status !== 'idle') resetGithubPreview();
            return;
        }

        if (githubPreview.repoUrl && githubPreview.repoUrl !== nextUrl) {
            resetGithubPreview();
        }
    }, [importSourceType, watchedRepoUrl, githubPreview.status, githubPreview.repoUrl, resetGithubPreview]);

    const startGithubRootPreview = useCallback(async (repoUrl: string, branchOverride?: string | null) => {
        const url = (repoUrl || '').trim();
        if (!url) return;
        const requestedBranch = branchOverride ?? watchedBranch ?? null;
        const requestKey = `${url}#${requestedBranch || ''}`;
        latestGithubPreviewRequestRef.current = requestKey;

        // Clear the previous repository before requesting a new manifest so its
        // files can never be presented under the next repository's identity.
        setGithubFolderEntries({});
        setGithubPreview((prev) => {
            if (
                prev.status === 'loading'
                && prev.repoUrl === url
                && (prev.branch ?? null) === requestedBranch
            ) return prev;
            return {
                status: 'loading',
                repoUrl: url,
                branch: requestedBranch,
                rootEntries: [],
                errorMessage: null,
            };
        });

        try {
            const parsed = parseGithubRepo(url);
            if (!parsed) {
                setGithubPreview((prev) => ({ ...prev, status: 'error', errorMessage: 'Invalid GitHub repo URL.' }));
                return;
            }

            const preferredInstallationId = (getValues('import_source.metadata') as any)?.githubInstallationId ?? null;
            const res = await fetchGithubImportPreviewRoot({
                repoUrl: url,
                branch: requestedBranch,
                installationId: preferredInstallationId,
            });
            if (latestGithubPreviewRequestRef.current !== requestKey) return;
            const branch = res.branch || 'main';

            // Store branch in form so the import worker uses the same ref.
            if (!watchedBranch && branch) {
                setValue('import_source.branch', branch, { shouldDirty: true });
            }
            const normalizedUrl = res.normalizedRepoUrl || url;
            const rootEntries = res.rootEntries;

            setGithubFolderEntries({ '': rootEntries });
            setGithubPreview({
                status: 'ready',
                repoUrl: normalizedUrl,
                branch,
                rootEntries,
                errorMessage: null,
            });
            if (normalizedUrl !== url) {
                setValue('import_source.repoUrl', normalizedUrl, { shouldDirty: true });
            }
        } catch (e: any) {
            if (latestGithubPreviewRequestRef.current !== requestKey) return;
            const message = typeof e?.message === 'string' ? e.message : 'Couldn’t preview repository.';
            setGithubPreview((prev) => ({
                ...prev,
                status: 'error',
                repoUrl: url,
                errorMessage: message,
                rootEntries: [],
            }));
        }
    }, [getValues, setValue, watchedBranch]);

    const loadGithubFolder = useCallback(async (folderPath: string) => {
        const baseUrl = (githubPreview.repoUrl || '').trim();
        const branch = githubPreview.branch || watchedBranch || null;
        if (!baseUrl || !branch) return;

        const key = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
        if (githubFolderEntries[key]) return;

        // Don’t fetch ignored folders.
        if (shouldIgnorePath(key)) {
            setGithubFolderEntries((prev) => ({ ...prev, [key]: [] }));
            return;
        }

        const parsed = parseGithubRepo(baseUrl);
        if (!parsed) return;

        try {
            const preferredInstallationId = (getValues('import_source.metadata') as any)?.githubInstallationId ?? null;
            const res = await fetchGithubImportPreviewFolder({
                repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
                branch,
                path: key,
                installationId: preferredInstallationId,
            });
            if ((getValues('import_source.repoUrl') || '').trim() !== baseUrl || (getValues('import_source.branch') || branch) !== branch) {
                return;
            }
            const entries = res.entries;
            setGithubFolderEntries((prev) => ({ ...prev, [key]: entries }));
        } catch {
            if ((getValues('import_source.repoUrl') || '').trim() !== baseUrl || (getValues('import_source.branch') || branch) !== branch) {
                return;
            }
            // Non-blocking: folder expansion can fail silently; keep UX smooth.
            setGithubFolderEntries((prev) => ({ ...prev, [key]: [] }));
        }
    }, [getValues, githubFolderEntries, githubPreview.branch, githubPreview.repoUrl, watchedBranch]);

    // --- Draft Management ---

    // Check for existing draft on mount
    useEffect(() => {
        const checkDraft = async () => {
            const { draftStore } = await import('@/lib/storage/draft-store');
            const info = await draftStore.getInfo(userId);
            if (info.exists) {
                setDraftInfo({
                    exists: true,
                    phase: info.phase,
                    savedAt: info.savedAt,
                    parentOrgId: info.parentOrgId ?? null,
                });
            }
        };
        checkDraft();
    }, [userId]);

    const restoreDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');
        const draft = await draftStore.load(userId);
        if (draft) {
            reset(draft);
            if (draft._timestamp) setLastSaved(new Date(draft._timestamp));
            let targetPhase = (draft._phase || 1) as WizardPhaseId;
            // Validate step by step up to targetPhase to ensure user doesn't land on a later phase with invalid earlier data
            if (targetPhase > 1) {
                const source = draft.import_source?.type;
                if (!source || (source === 'github' && !draft.import_source?.repoUrl)) {
                    targetPhase = 1;
                }
            }
            if (targetPhase > 2) {
                const titleValid = typeof draft.title === 'string' && draft.title.trim().length >= 3;
                const descValid = typeof draft.description === 'string' && draft.description.trim().length >= 20;
                const typeValid = typeof draft.project_type === 'string' && draft.project_type.trim().length > 0;
                const customTypeValid = draft.project_type !== 'other' || (typeof draft.custom_project_type === 'string' && draft.custom_project_type.trim().length > 0);
                if (!titleValid || !descValid || !typeValid || !customTypeValid) {
                    targetPhase = 2;
                }
            }
            if (targetPhase > 3) {
                if (Array.isArray(draft.roles)) {
                    const hasInvalidRole = draft.roles.some((r: any) => !r.role || !r.role.trim());
                    if (hasInvalidRole) targetPhase = 3;
                }
            }
            setPhase(targetPhase);
            setDraftInfo(null);
            toast.success("Draft restored");
        }
    }, [reset, userId]);

    const deleteDraft = useCallback(async () => {
        const { draftStore } = await import('@/lib/storage/draft-store');

        // Client-side total wipe
        await draftStore.clear(userId);
        setDraftInfo(null);
        reset();
        setPhase(1);
        toast.success("Draft deleted");
    }, [reset, userId]);

    const saveDraft = useCallback(async (silent = false) => {
        if (!silent) {
            setIsSavingDraft(true);
            setSaveStatus('saving');
        }
        try {
            const { draftStore } = await import('@/lib/storage/draft-store');
            await draftStore.save(getValues(), phaseRef.current, userId);
            setLastSaved(new Date());
            if (!silent) {
                setSaveStatus('saved');
                window.setTimeout(() => setSaveStatus('idle'), 2000);
            }
        } catch (error) {
            console.error('[create-project] Failed to save draft', error);
            setSaveStatus('error');
            if (!silent) toast.error('Couldn’t save the draft', { description: 'Try again.' });
        } finally {
            if (!silent) setIsSavingDraft(false);
        }
    }, [getValues, userId]);

    // Auto-Save Optimization (Debounced subscription covering both user and programmatic edits)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        const subscription = watch(() => {
            if (!isDirty) return;

            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(() => saveDraft(true), 5000);
        });
        return () => {
            subscription.unsubscribe();
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [isDirty, watch, saveDraft]);

    // --- Role Management ---
    const addRole = useCallback((init?: Partial<OpenRoleInput>) => {
        appendOpenRole({
            role: '',
            count: 1,
            description: '',
            skills: [],
            experienceLevel: 'any',
            compensationType: 'unpaid',
            compensationDetails: '',
            ...init,
        }, { shouldFocus: false });
    }, [appendOpenRole]);

    const duplicateRole = useCallback((index: number) => {
        const role = (getValues('roles') || [])[index];
        if (!role) return;
        insertOpenRole(index + 1, { ...role, role: `${role.role.trim()} (copy)`.slice(0, 100), people: [], lead_user_id: undefined }, { shouldFocus: false });
    }, [getValues, insertOpenRole]);

    const moveRole = useCallback((from: number, to: number) => {
        const length = (getValues('roles') || []).length;
        if (from === to || from < 0 || to < 0 || from >= length || to >= length) return;
        moveOpenRole(from, to);
    }, [getValues, moveOpenRole]);

    const updateRole = useCallback((index: number, updates: Partial<OpenRoleInput>) => {
        const roles = getValues('roles') || [];
        const currentRole = roles[index];
        if (!currentRole) return;

        setValue(`roles.${index}` as any, { ...currentRole, ...updates }, { shouldDirty: true, shouldValidate: true });
    }, [getValues, setValue]);

    const removeRole = useCallback((index: number) => {
        removeOpenRole(index);
    }, [removeOpenRole]);

    const prefilledUnitsFor = useRef<string | null>(null);
    const prefillUnits = useCallback((orgId: string, names: string[]) => {
        if (prefilledUnitsFor.current === orgId || names.length === 0 || (getValues('roles') ?? []).length > 0) return;
        prefilledUnitsFor.current = orgId;
        appendOpenRole(names.map((role) => ({ role, count: 1, description: '', skills: [], experienceLevel: 'any' as const, compensationType: 'unpaid' as const, compensationDetails: '' })));
    }, [appendOpenRole, getValues]);

    const wizardContext: WizardContextType = useMemo(() => ({
        openRoles,
        openRoleIds: openRoleFields.map((field) => field.id),
        addRole,
        updateRole,
        removeRole,
        duplicateRole,
        moveRole,
        prefillUnits,
    }), [openRoles, openRoleFields, addRole, updateRole, removeRole, duplicateRole, moveRole, prefillUnits]);

    // Phase is navigation only. Reaching a later step does not make the
    // project dirty, so closing after restoring all values must not prompt.
    // Keep the two non-form inputs that would otherwise be lost in the check.
    const hasUnsavedWizardChanges = isDirty
        || Boolean(uploadFiles?.length)
        || Boolean(projectImage);

    // Leaving without the confirm dialog (browser Back) keeps the work: unsaved changes become a
    // draft on unmount. "Leave setup" and a successful create opt out via markLeaving().
    const skipDraftOnUnmountRef = useRef(false);
    const hasUnsavedRef = useRef(hasUnsavedWizardChanges);
    const saveDraftRef = useRef(saveDraft);
    useEffect(() => {
        hasUnsavedRef.current = hasUnsavedWizardChanges;
        saveDraftRef.current = saveDraft;
    }, [hasUnsavedWizardChanges, saveDraft]);
    useEffect(() => () => {
        if (hasUnsavedRef.current && !skipDraftOnUnmountRef.current) void saveDraftRef.current(true);
    }, []);
    const markLeaving = useCallback(() => {
        skipDraftOnUnmountRef.current = true;
    }, []);

    useEffect(() => {
        if (phase !== TOTAL_PHASES) setIsReviewReady(false);
    }, [phase]);

    useEffect(() => () => {
        if (phaseTransitionTimerRef.current) clearTimeout(phaseTransitionTimerRef.current);
    }, []);

    // --- Navigation ---
    // One step's checks (what Continue runs). Back to Review runs them for every step on the way (create wizard v6).
    const validatePhase = useCallback(async (p: WizardPhaseId): Promise<boolean> => {
        let isValid = false;
        if (p === 1) {
            const importType = getValues('import_source.type') || 'scratch';
            if (importType === 'github') {
                const repoUrl = (getValues('import_source.repoUrl') || '').trim();
                if (!repoUrl) {
                    toast.error('Paste a GitHub repository link');
                    return false;
                }

                const metadata = (getValues('import_source.metadata') || {}) as Record<string, unknown>;
                const preflightReady = metadata.githubPreflightStatus === 'ok';
                if (!preflightReady) {
                    toast.info('Check the repository before continuing.');
                    return false;
                }

                const previewReady = githubPreview.status === 'ready' && githubPreview.repoUrl === repoUrl;
                if (!previewReady) {
                    toast.info('Continuing without full preview', { description: 'Import checks passed.' });
                }
            }
            if (importType === 'upload') {
                if (!uploadFiles || uploadFiles.length === 0) {
                    toast.error('Select a folder first');
                    return false;
                }
                const metadata = (getValues('import_source.metadata') || {}) as Record<string, unknown>;
                if (metadata.uploadValidationStatus !== 'ok') {
                    toast.error(feedbackError(String(metadata.uploadValidationError || 'Resolve blocked files before continuing'), "Resolve blocked files before continuing"));
                    return false;
                }
            }
            const organization = getValues('organization');
            if (organization && (!organization.org_type || (organization.org_type === 'other' && !organization.type_label?.trim()))) {
                toast.warning(organization.org_type ? 'Say what you call it, for example Nonprofit' : 'Choose what kind of organization this is');
                return false;
            }
            if (organization?.org_type === 'other' && organization.kit === 'event_team' && !organization.key_date) {
                toast.warning('Pick the event date: the plan works back from it');
                return false;
            }

            isValid = true;
        } else if (p === 2) {
            const fieldsToValidate: Array<'project_type' | 'custom_project_type' | 'title' | 'description'> = ['project_type', 'title', 'description'];
            if (getValues('project_type') === 'other') {
                fieldsToValidate.push('custom_project_type');
            }
            setPhase2ValidationAttempted(true);
            isValid = await trigger(fieldsToValidate, { shouldFocus: true });
            const organization = getValues('organization');
            if (isValid && organization) {
                const handle = await checkOrgHandleAction(organization.handle || '');
                if (!handle.available) {
                    toast.error(handle.message);
                    document.getElementById('create-org-handle')?.focus();
                    isValid = false;
                } else {
                    setValue('organization.handle', handle.handle ?? '', { shouldDirty: true });
                    isValid = await trigger(['organization'], { shouldFocus: true });
                }
            }
            if (isValid) setPhase2ValidationAttempted(false);
        } else if (p === 3) {
            setPhase3ValidationAttempted(true);
            isValid = await trigger(['creator_role', 'roles'], { shouldFocus: true });
            if (isValid) setPhase3ValidationAttempted(false);
        } else if (p === 4) {
            setPhase4ValidationAttempted(true);
            if (phase4LinkComposerPending) {
                toast.error('Finish the workspace link');
                isValid = false;
            } else {
                isValid = (await trigger(['visibility', 'external_links'], { shouldFocus: true })) && (await trigger(['lifecycle_stages']));
            }
            if (isValid) setPhase4ValidationAttempted(false);
        } else if (p === 5) {
            isValid = true;
        }
        return isValid;
    }, [trigger, getValues, setValue, githubPreview.repoUrl, githubPreview.status, phase4LinkComposerPending, uploadFiles]);

    const handleNext = useCallback(async () => {
        if (isSubmitting || phaseTransitionRef.current) return;

        phaseTransitionRef.current = true;
        setIsPhaseTransitioning(true);
        let isValid = false;
        let holdTransitionForReview = false;

        try {
            isValid = await validatePhase(phase);

            if (isValid && phase < TOTAL_PHASES) {
                holdTransitionForReview = phase === TOTAL_PHASES - 1;
                if (holdTransitionForReview) setIsReviewReady(false);
                if (phase + 1 === TOTAL_PHASES) setFromReview(false);
                setPhase(prev => (prev + 1) as WizardPhaseId);
            }
        } finally {
            const releaseTransition = () => {
                phaseTransitionRef.current = false;
                setIsPhaseTransitioning(false);
                phaseTransitionTimerRef.current = null;
            };

            if (holdTransitionForReview) {
                phaseTransitionTimerRef.current = setTimeout(releaseTransition, 350);
            } else {
                releaseTransition();
            }
        }
    }, [phase, isSubmitting, validatePhase]);

    const handleBack = useCallback(() => {
        if (isSubmitting || phaseTransitionRef.current) return;
        if (phase > 1) {
            setPhase(prev => (prev - 1) as WizardPhaseId);
        }
    }, [isSubmitting, phase]);

    const goToPhase = useCallback((target: WizardPhaseId) => {
        if (isSubmitting || phaseTransitionRef.current) return;
        setIsReviewReady(false);
        // Left Review to change one thing: the footer offers Back to Review instead of walking every step again.
        if (phaseRef.current === TOTAL_PHASES && target < TOTAL_PHASES) setFromReview(true);
        if (target === TOTAL_PHASES) setFromReview(false);
        setPhase(target);
    }, [isSubmitting]);

    const returnToReview = useCallback(async () => {
        if (isSubmitting || phaseTransitionRef.current) return;
        phaseTransitionRef.current = true;
        setIsPhaseTransitioning(true);
        try {
            for (let p = phaseRef.current; p < TOTAL_PHASES; p++) {
                if (!(await validatePhase(p as WizardPhaseId))) { setPhase(p as WizardPhaseId); return; }
            }
            setIsReviewReady(false);
            setFromReview(false);
            setPhase(TOTAL_PHASES as WizardPhaseId);
        } finally {
            phaseTransitionRef.current = false;
            setIsPhaseTransitioning(false);
        }
    }, [isSubmitting, validatePhase]);

    const handleCloseAttempt = useCallback(() => {
        if (hasUnsavedWizardChanges) setShowExitConfirm(true);
        else onClose();
    }, [hasUnsavedWizardChanges, onClose]);

    // --- Submission (create wizard v6): one runner per step in createSteps order, reported to the Creating view ---
    const [createProgress, setCreateProgress] = useState<CreateProgress | null>(null);
    const [finished, setFinished] = useState<CreateFinished | null>(null);
    const progressRef = useRef<CreateProgress | null>(null);
    progressRef.current = createProgress;
    const runRef = useRef<{ steps: CreateStep[]; runners: Array<() => Promise<void>>; projectId: string | null; slug: string | null; organization?: CreatedOrganization; stopped: boolean } | null>(null);
    // Leaving the page stops following the import (it keeps going on the server) and any steps not started yet.
    useEffect(() => () => { if (runRef.current) runRef.current.stopped = true; }, []);

    const completeRun = useCallback(async (extra?: Pick<CreateFinished, 'partial' | 'importing'>) => {
        const run = runRef.current;
        if (!run?.projectId) return;
        run.stopped = true;
        const { draftStore } = await import('@/lib/storage/draft-store');
        await draftStore.clear(userId).catch(() => undefined);
        skipDraftOnUnmountRef.current = true;
        submissionRef.current = false;
        setIsSubmitting(false);
        setFinished({ projectId: run.projectId, slug: run.slug, organization: run.organization, ...extra });
    }, [userId]);

    /** Runs the steps from `start`. A step that fails stops the run there; what's made stays made. */
    const runFrom = useCallback(async (start: number) => {
        const run = runRef.current;
        if (!run) return;
        for (let i = start; i < run.steps.length; i++) {
            if (run.stopped) return;
            setCreateProgress((p) => (p ? { ...p, index: i, failedAt: undefined, error: undefined, count: undefined, total: undefined } : p));
            try {
                await run.runners[i]!();
            } catch (error) {
                if (!run.projectId) throw error;
                console.warn('[create-project] Step failed', run.steps[i]!.key, error);
                setCreateProgress((p) => (p ? { ...p, failedAt: i, error: error instanceof Error ? error.message : 'It stopped.' } : p));
                return;
            }
        }
        if (!run.stopped) await completeRun();
    }, [completeRun]);

    const retryFrom = useCallback((index: number) => runFrom(index), [runFrom]);
    /** Only the GitHub import is left: finish now; the import keeps going on the server (nothing is cancelled). */
    const openNow = useCallback(() => {
        const p = progressRef.current;
        void completeRun({ importing: { at: p?.count ?? 0, total: p?.total ?? 0 } });
    }, [completeRun]);
    /** A step failed: open what was made; the failed step becomes the first Get started task. */
    const openAnyway = useCallback(() => {
        const p = progressRef.current;
        const step = p && p.failedAt !== undefined ? p.steps[p.failedAt] : undefined;
        void completeRun(step ? { partial: { key: step.key, label: step.label, at: p?.count, total: p?.total } } : undefined);
    }, [completeRun]);

    const onSubmit = useCallback(async (data: CreateWorkspaceInput) => {
        if (phase !== TOTAL_PHASES || !isReviewReady || phaseTransitionRef.current || submissionRef.current) return;

        submissionRef.current = true;
        setIsSubmitting(true);
        const importType = data.import_source?.type || 'scratch';
        // Audit N26: an organization is called one here too.
        const noun = data.organization ? 'Organization' : 'Workspace';
        // Things that didn't stop a step (an invitation refused by privacy rules, a template that fell back).
        const creationWarnings: string[] = [];
        const warnCreation = (message: string) => {
            if (creationWarnings.includes(message)) return;
            creationWarnings.push(message);
            toast.warning(`${noun} created`, { description: message });
        };
        let createdProjectId: string | null = null;
        let uploadSessionContext: { sessionId?: string; manifestHash?: string } | null = null;
        const resolvedRoles = (data.roles || []).filter((role) => (role.role || '').trim().length > 0);
        const readmeIntent = data.readme ?? {
            mode: 'starter' as const,
            sourcePath: null,
            publishOnCreate: false,
            includeRoles: true,
        };
        let readmeApplied = false;

        const uploadMetadata = (data.import_source?.metadata || {}) as Record<string, unknown>;

        const applyReadmeSetup = async (projectId: string) => {
            if (readmeApplied) return;
            if (readmeIntent.mode === 'skip') {
                readmeApplied = true;
                return;
            }

            try {
                const fromTemplate = readmeIntent.orgTemplateDocId
                    ? await import('@/app/actions/org-docs').then((m) => m.readOrgTemplateCopyAction(projectId, readmeIntent.orgTemplateDocId!))
                    : null;
                if (fromTemplate && !fromTemplate.success) warnCreation('The org template could not be copied; the starter doc was used instead.');
                // Organizations start from their type's template (report §34.5).
                const orgDoc = data.organization?.org_type
                    ? (await import('@/lib/organizations/creation')).orgStarterDoc(data.organization.org_type, { title: data.title, description: data.description, audience: data.problem_statement, activities: data.solution_statement })
                    : null;
                const starterContent = fromTemplate?.success ? fromTemplate.content : orgDoc ?? buildWorkspaceDocStarterDraft({
                    title: data.title,
                    shortDescription: data.short_description,
                    description: data.description,
                    projectType: data.project_type === 'other'
                        ? data.custom_project_type || data.project_type
                        : data.project_type,
                    technologies: data.technologies_used || [],
                    tags: data.tags || [],
                    roles: resolvedRoles,
                    includeRoles: readmeIntent.includeRoles !== false,
                });
                // ponytail: dynamic import keeps doc server action out of initial wizard bundle. ceiling: 1 doc creation per project. upgrade: static import if wizard bundle is consolidated.
                const { applyCreationIntentAction } = await import('@/app/actions/workspace/doc');
                await applyCreationIntentAction(projectId, {
                    mode: readmeIntent.mode,
                    sourcePath: readmeIntent.sourcePath || null,
                    starterContent,
                    publishOnCreate: readmeIntent.publishOnCreate ?? false,
                    includeRoles: readmeIntent.includeRoles !== false,
                });
                readmeApplied = true;
            } catch (error) {
                console.warn('[create-project] Doc setup failed', error);
                throw new Error('The starter doc wasn’t drafted.');
            }
        };

        // Step 4 settings that need the project to exist first. Failures never undo creation;
        // both stay editable in Project settings.
        // Report §23.6: copy an org Template folder into the new project (same files, recorded as org copies).
        const copyOrgTemplateFolder = async (projectId: string, orgFolderId: string) => {
            const [{ browseOrgFilesAction, listOrgTemplateFoldersAction, recordOrgCopyAction }, { createFolder }, { uploadWorkspaceFile }] = await Promise.all([
                import('@/app/actions/org-files'), import('@/app/actions/files/mutations'), import('@/components/organizations/OrgDocParts'),
            ]);
            let copied = 0;
            const walk = async (sourceId: string, targetId: string | null, depth: number): Promise<void> => {
                const listed = await browseOrgFilesAction(projectId, sourceId);
                if (!listed.success) throw new Error(listed.error);
                for (const node of listed.nodes) {
                    if (copied >= 100) return; // ponytail: 100 files per template; larger trees go through Files → Copy.
                    if (node.type === 'folder') {
                        if (depth < 5) await walk(node.id, (await createFolder(projectId, targetId, node.name)).id, depth + 1);
                        continue;
                    }
                    const response = await fetch(`/api/v1/workspaces/${listed.org.id}/files/${node.id}/preview`);
                    if (!response.ok) continue;
                    const created = await uploadWorkspaceFile(projectId, targetId, node.name, await response.blob());
                    await recordOrgCopyAction(projectId, created.id, node.id);
                    copied += 1;
                }
            };
            const root = (await listOrgTemplateFoldersAction(data.parent_org_id!)).find((f) => f.id === orgFolderId);
            await walk(orgFolderId, (await createFolder(projectId, null, root?.name ?? 'Template')).id, 0);
        };

        const applyLaunchSettingsAfterCreate = async (projectId: string) => {
            if (data.parent_org_id && data.org_template_folder_id) {
                try {
                    await copyOrgTemplateFolder(projectId, data.org_template_folder_id);
                } catch (error) {
                    console.warn('[create-project] Org template copy failed', error);
                    warnCreation('The org template could not be copied; copy it from Files.');
                }
            }
            if (projectImage) {
                try {
                    const { uploadWorkspaceImage } = await import('@/lib/upload/workspace-image-upload-client');
                    await uploadWorkspaceImage(projectId, projectImage);
                } catch (error) {
                    console.warn('[create-project] Project picture upload failed', error);
                    warnCreation('Image upload failed.');
                }
            }
            if (readmeIntent.mode !== 'skip' && data.doc_edit_policy === 'members') {
                try {
                    const { updateWorkspaceDocSettingsAction } = await import('@/app/actions/workspace/doc');
                    const result = await updateWorkspaceDocSettingsAction(projectId, { editPolicy: 'members' });
                    if (!result.success) warnCreation('Only the owner and admins can edit the doc for now. Change it in Settings.');
                } catch (error) {
                    console.warn('[create-project] Doc editing setting failed', error);
                    warnCreation('Only the owner and admins can edit the doc for now. Change it in Settings.');
                }
            }
        };

        const pre = () => {
            if (importType === 'upload') {
                if (!uploadFiles || uploadFiles.length === 0) throw new Error('Select a folder to upload.');
                if (uploadMetadata.uploadValidationStatus !== 'ok') throw new Error(String(uploadMetadata.uploadValidationError || 'The selected folder contains blocked files.'));
            }
        };
        const projectIdOrThrow = () => {
            if (!createdProjectId) throw new Error('Workspace creation did not return a workspace ID.');
            return createdProjectId;
        };
        const placed = [...resolvedRoles.flatMap((role) => role.people ?? []), ...(data.unassigned_people ?? [])].length;
        const steps = createSteps(data, { uploadCount: uploadFiles?.length ?? 0, peopleCount: placed, orgTitle: null });
        const run = { steps, runners: [] as Array<() => Promise<void>>, projectId: null as string | null, slug: null as string | null, organization: undefined as CreatedOrganization | undefined, stopped: false };
        run.runners = steps.map((step) => {
            if (step.key === 'make') return async () => {
                // Try again after the workspace exists never makes a second one: only what follows creation re-runs.
                if (run.projectId) { await applyLaunchSettingsAfterCreate(run.projectId); return; }
                const result = await createWorkspaceAction({ ...data, roles: resolvedRoles });
                if (!result.success || !result.project) throw Object.assign(new Error(result.error || 'Creation failed'), { code: (result as { code?: string }).code });
                createdProjectId = result.project.id;
                run.projectId = result.project.id;
                run.slug = result.project.slug ?? null;
                // It exists now: leaving from here on must not save it as a draft (restoring that would make it twice).
                skipDraftOnUnmountRef.current = true;
                void import('@/lib/storage/draft-store').then(({ draftStore }) => draftStore.clear(userId)).catch(() => undefined);
                if (result.project.joinCode) run.organization = { title: result.project.title, joinCode: result.project.joinCode, handle: result.project.slug ?? data.organization?.handle ?? null, invites: result.project.invites, creatorTitle: data.organization?.creator_title || null, joinMode: data.organization?.join_mode ?? null };
                for (const notice of result.notices ?? []) warnCreation(notice);
                setCreateProgress((p) => (p ? { ...p, projectId: result.project!.id } : p));
                // Picture, template folder and doc editing ride along with making it; each stays editable in Settings.
                await applyLaunchSettingsAfterCreate(result.project.id);
            };
            // A README read from an uploaded folder needs the files first; it's drafted at the end of the upload.
            if (step.key === 'doc') return async () => { if (!(importType === 'upload' && readmeIntent.mode === 'detected')) await applyReadmeSetup(projectIdOrThrow()); };
            if (step.key.startsWith('workflow:')) return async () => {
                const { addWorkflowsOnCreateAction } = await import('@/app/actions/workflows');
                const added = await addWorkflowsOnCreateAction(projectIdOrThrow(), [step.key.slice('workflow:'.length)]).catch(() => null);
                if (!added?.success) throw new Error('The tab wasn’t added. Add it later from + Add workflow.');
            };
            // People and openings are saved with the workspace itself (createWorkspaceAction).
            if (step.key === 'people' || step.key === 'openings') return async () => undefined;
            if (step.key === 'upload') return async () => {
                pre();
                if (!uploadFiles) return;
                setUploadProgress({ percent: 0, currentFile: '', isUploading: true });
                try {
                    const createdProjectId = projectIdOrThrow();
                    const [{ uploadFolder }, uploadActions, importActions] = await Promise.all([
                        import('@/lib/upload/chunked-upload'),
                        import('@/app/actions/upload'),
                        import('@/app/actions/upload-import'),
                    ]);

                    const { getUploadPresignedUrl, getBatchUploadUrls } = uploadActions;
                    const { registerUploadedFolderAction, updateUploadSessionAction } = importActions;
                    const uploadProjectId = createdProjectId;
                    const totalFiles = uploadFiles.length;
                    if (!uploadProjectId) {
                        throw new Error('Workspace creation did not return a workspace ID.');
                    }

                    const filesArr = Array.from(uploadFiles);
                    const meta = filesArr.map((f) => {
                        const relativePath = f.webkitRelativePath || f.name;
                        const key = buildWorkspaceFileKey(uploadProjectId, relativePath);
                        return {
                            key,
                            relativePath,
                            size: f.size,
                            mimeType: f.type || 'application/octet-stream',
                        };
                    });
                    const sessionId = globalThis.crypto?.randomUUID?.()
                        || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                    const manifestHash = buildUploadManifestHash(
                        meta.map((entry) => ({
                            relativePath: entry.relativePath,
                            size: entry.size,
                            mimeType: entry.mimeType,
                        }))
                    );
                    const importEventId = buildWorkspaceImportEventId({
                        projectId: uploadProjectId,
                        source: 'upload',
                        normalizedTarget: 'upload',
                        branchOrManifestHash: manifestHash,
                    });
                    uploadSessionContext = { sessionId, manifestHash };

                    await updateUploadSessionAction(uploadProjectId, {
                        sessionId,
                        manifestHash,
                        totalFiles: meta.length,
                        uploadedFiles: 0,
                        status: 'uploading',
                        importEventId,
                    });

                    // Batch-cache presigned URLs up to 50 at a time to minimize server roundtrips
                    const presignCache = new Map<string, {
                        url: string;
                        uploadToken: string;
                        storageKey: string;
                        uploadIntentId: string;
                    }>();
                    let pendingBatchPromise: Promise<void> | null = null;
                    let nextBatchIndex = 0;

                    const fetchNextBatch = async () => {
                        if (nextBatchIndex >= meta.length) return;
                        const batchItems = meta.slice(nextBatchIndex, nextBatchIndex + 50).map((m) => ({
                            key: m.key,
                            contentType: m.mimeType,
                            sizeBytes: m.size,
                        }));
                        nextBatchIndex += 50;

                        try {
                            const res = await getBatchUploadUrls(batchItems, { sessionId });
                            if (!('error' in res)) {
                                for (const item of batchItems) {
                                    const url = res.urls[item.key];
                                    const uploadToken = res.uploadTokens[item.key];
                                    const storageKey = res.storageKeys[item.key];
                                    const uploadIntentId = res.uploadIntentIds[item.key];
                                    if (url && storageKey && uploadIntentId) {
                                        presignCache.set(item.key, {
                                            url,
                                            uploadToken: uploadToken || '',
                                            storageKey,
                                            uploadIntentId,
                                        });
                                    }
                                }
                            }
                        } catch {
                            // Fall back transparently to single presign on batch failure
                        }
                    };

                    const getPresignedUrl = async (key: string, contentType: string, sizeBytes: number) => {
                        if (presignCache.has(key)) {
                            return presignCache.get(key)!;
                        }

                        while (!presignCache.has(key) && nextBatchIndex < meta.length) {
                            if (!pendingBatchPromise) {
                                pendingBatchPromise = fetchNextBatch().finally(() => {
                                    pendingBatchPromise = null;
                                });
                            }
                            await pendingBatchPromise;
                            if (presignCache.has(key)) {
                                return presignCache.get(key)!;
                            }
                        }

                        if (presignCache.has(key)) {
                            return presignCache.get(key)!;
                        }

                        const single = await getUploadPresignedUrl(key, contentType, sizeBytes, { sessionId });
                        if ('error' in single) throw new Error(single.error);
                        return {
                            url: single.url,
                            uploadToken: single.token,
                            storageKey: single.storageKey,
                            uploadIntentId: single.uploadIntentId,
                        };
                    };

                    const uploadRes = await uploadFolder(
                        uploadFiles,
                        uploadProjectId,
                        (p) => {
                            setUploadProgress({
                                percent: p.percent,
                                currentFile: p.currentFile,
                                isUploading: p.percent < 100,
                            });
                            setCreateProgress((prev) => (prev ? { ...prev, count: Math.min(totalFiles, Math.round((p.percent / 100) * totalFiles)), total: totalFiles } : prev));
                        },
                        getPresignedUrl,
                        {
                            sessionId,
                            manifestHash,
                        }
                    );

                    // Register ONLY successfully uploaded files so Files tab never references missing keys
                    const uploadedByRequestKey = new Map(
                        uploadRes.uploadedAssets.map((asset) => [asset.requestKey, asset]),
                    );
                    const manifest = meta
                        .map((m) => {
                            const uploaded = uploadedByRequestKey.get(m.key);
                            if (!uploaded) return null;
                            return {
                                relativePath: m.relativePath,
                                size: m.size,
                                mimeType: m.mimeType,
                                storageKey: uploaded.storageKey,
                                uploadIntentId: uploaded.uploadIntentId,
                            };
                        })
                        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

                    await updateUploadSessionAction(uploadProjectId, {
                        sessionId,
                        manifestHash,
                        totalFiles: meta.length,
                        uploadedFiles: manifest.length,
                        status: 'registering',
                        importEventId,
                    });

                    const registerResult = await registerUploadedFolderAction(uploadProjectId, manifest, {
                        sessionId,
                        manifestHash,
                        reconcilePolicy: 'mirror',
                    });
                    if (!registerResult.success) {
                        if (registerResult.skipped) {
                            const ownerInfo = registerResult.lockOwnerSessionId
                                ? ` (active session: ${registerResult.lockOwnerSessionId})`
                                : '';
                            console.info('[create-project] Upload registration skipped', ownerInfo);
                        } else {
                            throw new Error('Couldn’t register uploaded files.');
                        }
                    }

                    if (readmeIntent.mode === 'detected') await applyReadmeSetup(uploadProjectId);
                    setUploadProgress({ percent: 100, currentFile: '', isUploading: false });
                    if (!uploadRes.success) throw Object.assign(new Error(`${uploadRes.failedFiles.length} files didn’t upload.`), { uploaded: manifest.length });
                } catch (error) {
                    setUploadProgress(null);
                    // Files shows the upload as failed, with retry.
                    try {
                        const { markWorkspaceSyncFailedAction } = await import('@/app/actions/upload-import');
                        await markWorkspaceSyncFailedAction(projectIdOrThrow(), { sessionId: uploadSessionContext?.sessionId, manifestHash: uploadSessionContext?.manifestHash, reason: error instanceof Error ? error.message : 'Upload import failed' });
                    } catch { }
                    throw error;
                }
            };
            // The GitHub import runs on the server; this follows it (the same reading the Files banner uses).
            return async () => {
                const { getWorkspaceHydrationProgressAction } = await import('@/app/actions/workspace');
                const projectId = projectIdOrThrow();
                for (;;) {
                    if (run.stopped) return;
                    const meta = await getWorkspaceHydrationProgressAction(projectId).catch(() => null);
                    if (meta) setCreateProgress((p) => (p ? { ...p, count: meta.completed, total: meta.total } : p));
                    // The import ends on done, or incomplete (Files lists what's missing and can fetch it again).
                    if (meta?.status === 'done' || meta?.status === 'incomplete') return;
                    if (meta?.status === 'failed') throw new Error('GitHub stopped answering. Files shows the import as paused.');
                    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS));
                }
            };
        });

        try {
            pre();
            runRef.current = run;
            setFinished(null);
            setCreateProgress({ steps, index: 0, title: data.title || `the ${noun.toLowerCase()}` });
            await runFrom(0);
        } catch (error: any) {
            // Nothing was made: back to Review, everything entered stays.
            runRef.current = null;
            setCreateProgress(null);
            submissionRef.current = false;
            setIsSubmitting(false);
            if (error?.code === 'ORG_BLOCKED') {
                // Report §14.6: everything entered stays; the person can make it a personal project instead.
                toast.error(error.message, {
                    action: {
                        label: 'Create as a personal workspace',
                        onClick: () => {
                            setValue('parent_org_id', undefined);
                            setValue('lead_user_id', undefined);
                            if (getValues('visibility') === 'org') setValue('visibility', 'private');
                            void onSubmitRef.current?.(getValues());
                        },
                    },
                });
            }
            else toast.error(feedbackError(error?.message || 'Couldn’t create workspace', 'Couldn’t create workspace'));
        }
    }, [phase, isReviewReady, uploadFiles, projectImage, runFrom]);
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;

    return {
        fromReview, returnToReview, sourceFill, setSourceFill, undoSourceFill,
        phase, methods, wizardContext, isSubmitting, isSavingDraft, phase2ValidationAttempted, phase3ValidationAttempted, phase4ValidationAttempted,
        phase4LinkComposerPending, setPhase4LinkComposerPending,
        isPhaseTransitioning, isReviewReady, setIsReviewReady,
        uploadFiles, setUploadFiles, uploadProgress, setUploadProgress, projectImage, setProjectImage,
        saveStatus, lastSaved, showExitConfirm, setShowExitConfirm,
        handleNext, handleBack, goToPhase, saveDraft, handleCloseAttempt, markLeaving, hasUnsavedWizardChanges,
        githubPreview,
        githubFolderEntries,
        loadGithubFolder,
        startGithubRootPreview,
        onSubmit, draftInfo, restoreDraft, deleteDraft,
        createProgress, finished, retryFrom, openNow, openAnyway,
    };
}
